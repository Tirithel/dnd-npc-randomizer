/**
 * Default token art, generated on demand via OpenAI, plus repair of the broken
 * image references that ship with the bundled compendium.
 *
 * The compendium's prototype tokens point at paths from the original author's
 * install: a wildcard under `assets/dnd-npc-randomizer/` (resolved from the
 * Foundry data root, not from inside this module), plus `worlds/lidarion/...`
 * and `tokenizer/_cache/...` images. None exist in a fresh install, so Foundry
 * fails the wildcard lookup and reports "Error retrieving wildcard tokens".
 *
 * Rather than shipping placeholder art, the module generates a default set with
 * the same OpenAI pipeline used for individual NPCs, and repoints broken
 * references at it. Repair never leaves a token in an erroring state: if no
 * defaults have been generated yet, the reference falls back to Foundry's own
 * mystery-man icon, which is always present.
 */

import { OpenAIImageGenerator } from "./openai-image.js";

const MODULE_ID = "dnd-npc-randomizer";

/** Ancestries that get their own default art, matching the shipped name tables. */
export const DEFAULT_ANCESTRIES = ["human", "dwarf", "elf", "tiefling"];

/** Genders generated per ancestry. */
export const DEFAULT_GENDERS = ["male", "female"];

/**
 * Foundry's own placeholder, used when no generated default is available.
 * An explicit, always-present path is safer than an empty source: it renders
 * predictably and cannot be mistaken for an unresolvable wildcard.
 * @returns {string} Path to the core mystery-man icon.
 */
function placeholderImage() {
    return globalThis.CONST?.DEFAULT_TOKEN ?? "icons/svg/mystery-man.svg";
}

/**
 * Resolves the FilePicker implementation across Foundry versions.
 * @returns {typeof FilePicker} The active FilePicker class.
 */
function getFilePicker() {
    return foundry.applications?.apps?.FilePicker?.implementation
        ?? foundry.applications?.apps?.FilePicker
        ?? FilePicker;
}

export class DefaultTokens {

    /**
     * Cache of path -> resolvable, so sweeping hundreds of actors does not
     * issue hundreds of identical browse calls.
     * @type {Map<string, boolean>}
     */
    static _resolvable = new Map();

    /** Clears the resolvability cache. @returns {void} */
    static clearCache() {
        this._resolvable.clear();
    }

    /**
     * Directory holding generated default art, inside the world folder so it is
     * captured by a world export.
     * @returns {string} Path relative to the Foundry data directory.
     */
    static directory() {
        const base = OpenAIImageGenerator.resolveDirectory(
            game.settings.get(MODULE_ID, "openaiImagePath") || `worlds/{world}/npc-randomizer`);
        return `${base}/defaults`;
    }

    /**
     * The wildcard matching generated defaults for an ancestry/gender.
     *
     * @param {Object} [options] - Selection hints.
     * @param {string} [options.ancestry] - Ancestry name.
     * @param {string} [options.gender] - "male" or "female".
     * @returns {string} A wildcard path.
     */
    static defaultWildcard({ ancestry, gender } = {}) {
        const dir = this.directory();
        const a = String(ancestry || "").toLowerCase();
        const match = DEFAULT_ANCESTRIES.find(known => a.includes(known));

        // "female" first: it contains "male".
        const g = String(gender || "").toLowerCase();
        const genderPart = g.includes("female") ? "female" : (g.includes("male") ? "male" : null);

        if (match && genderPart) return `${dir}/Random_${match}_${genderPart}_*`;
        if (match) return `${dir}/Random_${match}_*`;
        return `${dir}/Random_npc_*`;
    }

    /**
     * Extracts ancestry/gender hints from an image path. The broken references
     * are conveniently named, e.g. "Random_noble_human_female".
     *
     * @param {string} src - The original image path.
     * @returns {{ancestry: string, gender: string}} Parsed hints, possibly empty.
     */
    static hintsFromPath(src) {
        const lower = String(src || "").toLowerCase();
        const ancestry = DEFAULT_ANCESTRIES.find(known => lower.includes(known)) || "";
        const gender = lower.includes("female") ? "female" : (lower.includes("male") ? "male" : "");
        return { ancestry, gender };
    }

    /**
     * Tests whether an image path resolves to at least one real file.
     *
     * @param {string} src - Path or wildcard.
     * @param {boolean} [wildcard=false] - Treat as a wildcard.
     * @returns {Promise<boolean>} True when something exists.
     */
    static async isResolvable(src, wildcard = false) {
        if (!src) return true; // empty means "use the system default", which never errors

        const cacheKey = `${wildcard ? "w:" : "f:"}${src}`;
        if (this._resolvable.has(cacheKey)) return this._resolvable.get(cacheKey);

        let ok = false;
        try {
            if (wildcard || src.includes("*")) {
                const FP = getFilePicker();
                const result = await FP.browse("data", src, { wildcard: true });
                ok = Array.isArray(result?.files) && result.files.length > 0;
            } else {
                const response = await fetch(foundry.utils.getRoute(src), { method: "HEAD" });
                ok = response.ok;
            }
        } catch (e) {
            ok = false;
        }

        this._resolvable.set(cacheKey, ok);
        return ok;
    }

    /**
     * Generates the default token set with OpenAI.
     *
     * One image per ancestry/gender by default. Each is a billed image call, so
     * this only ever runs when explicitly asked for, and existing files are
     * skipped unless `force` is set.
     *
     * @param {Object} [options] - Options.
     * @param {string[]} [options.ancestries] - Ancestries to cover.
     * @param {string[]} [options.genders] - Genders to cover.
     * @param {number} [options.variants=1] - Images per combination.
     * @param {string} [options.apiKey] - Key override.
     * @param {boolean} [options.force=false] - Regenerate even if files exist.
     * @param {boolean} [options.notify=true] - Surface progress notifications.
     * @returns {Promise<{generated: string[], skipped: string[], failed: string[]}>} Summary.
     */
    static async generateDefaults({
        ancestries = DEFAULT_ANCESTRIES,
        genders = DEFAULT_GENDERS,
        variants = 1,
        apiKey,
        force = false,
        notify = true
    } = {}) {
        const key = OpenAIImageGenerator.getApiKey(apiKey);
        if (!key) {
            if (notify) ui.notifications.error("NPC Randomizer: no OpenAI API key configured, cannot generate defaults.");
            return { generated: [], skipped: [], failed: [] };
        }

        const dir = this.directory();
        const generated = [];
        const skipped = [];
        const failed = [];

        // Include a generic pair as the last-resort fallback for anything whose
        // ancestry cannot be determined.
        const combos = [];
        for (const ancestry of ancestries) {
            for (const gender of genders) combos.push({ ancestry, gender });
        }
        combos.push({ ancestry: "npc", gender: "" });

        const total = combos.length * variants;
        if (notify) ui.notifications.info(`NPC Randomizer: generating ${total} default token image(s), this will take a while.`);

        for (const { ancestry, gender } of combos) {
            for (let n = 1; n <= variants; n++) {
                const stem = gender ? `Random_${ancestry}_${gender}_${n}` : `Random_${ancestry}_${n}`;

                if (!force && await this.isResolvable(`${dir}/${stem}*`, true)) {
                    skipped.push(stem);
                    continue;
                }

                const subject = ancestry === "npc"
                    ? "nondescript humanoid commoner"
                    : `${gender} ${ancestry}`;

                try {
                    const bytes = await OpenAIImageGenerator.requestImage({
                        apiKey: key,
                        prompt: OpenAIImageGenerator.buildPrompt({
                            race: ancestry === "npc" ? "" : ancestry,
                            gender: ancestry === "npc" ? "" : gender,
                            description: `A generic, neutral ${subject} suitable as a reusable default token. `
                                + "Ordinary clothing, no distinctive scars, jewellery or heraldry."
                        })
                    });

                    // Fixed stem, so the wildcard keeps matching on regeneration.
                    await OpenAIImageGenerator.saveImage(bytes, stem, dir);
                    generated.push(stem);
                    console.log(`${MODULE_ID} | Generated default token ${stem}`);
                } catch (error) {
                    console.error(`${MODULE_ID} | Default token ${stem} failed:`, error);
                    failed.push(`${stem}: ${error.message}`);
                    // A failure here is usually account-wide (bad key, quota,
                    // unverified org), so stop rather than burn through the rest.
                    if (notify) ui.notifications.error(`NPC Randomizer: ${error.message}`);
                    return { generated, skipped, failed };
                }
            }
        }

        this.clearCache();

        if (notify) {
            ui.notifications.info(
                `NPC Randomizer: defaults complete - ${generated.length} generated, ${skipped.length} already present.`);
        }

        return { generated, skipped, failed };
    }

    /**
     * Repairs a raw actor data object in place, before creation. Used during
     * compendium import so freshly imported NPCs are never broken.
     *
     * @param {Object} actorData - Actor data, as produced by `toObject()`.
     * @returns {Promise<boolean>} True when something changed.
     */
    static async repairActorData(actorData) {
        const proto = actorData?.prototypeToken;
        if (!proto) return false;

        const src = proto.texture?.src || "";
        const isWildcard = proto.randomImg === true || src.includes("*");
        if (await this.isResolvable(src, isWildcard)) return false;

        const replacement = await this.replacementFor(this.hintsFromPath(src));

        proto.texture = proto.texture || {};
        proto.texture.src = replacement.src;
        proto.randomImg = replacement.randomImg;

        if (actorData.img && !(await this.isResolvable(actorData.img))) {
            actorData.img = replacement.randomImg ? placeholderImage() : replacement.src;
        }

        return true;
    }

    /**
     * Chooses a safe replacement for a broken reference.
     *
     * Prefers generated defaults. When none exist the wildcard is cleared
     * instead of repointed, because an unresolvable wildcard is precisely what
     * raises "Error retrieving wildcard tokens" - an empty source simply falls
     * back to Foundry's own placeholder and never errors.
     *
     * @param {{ancestry: string, gender: string}} hints - Selection hints.
     * @returns {Promise<{src: string, randomImg: boolean}>} The replacement.
     */
    static async replacementFor(hints) {
        const wildcard = this.defaultWildcard(hints);
        if (await this.isResolvable(wildcard, true)) return { src: wildcard, randomImg: true };

        const generic = `${this.directory()}/Random_npc_*`;
        if (await this.isResolvable(generic, true)) return { src: generic, randomImg: true };

        return { src: placeholderImage(), randomImg: false };
    }

    /**
     * Sweeps world actors and repairs unresolvable token art and portraits.
     *
     * @param {Object} [options] - Options.
     * @param {boolean} [options.notify=true] - Surface a summary notification.
     * @returns {Promise<number>} How many actors were repaired.
     */
    static async repairWorldActors({ notify = true } = {}) {
        if (!game.user.isGM) return 0;

        this.clearCache();
        const updates = [];
        let clearedOnly = 0;

        for (const actor of game.actors) {
            const proto = actor.prototypeToken;
            const src = proto?.texture?.src || "";
            const isWildcard = proto?.randomImg === true || src.includes("*");

            const tokenOk = await this.isResolvable(src, isWildcard);
            const portrait = actor.img || "";
            const portraitOk = await this.isResolvable(portrait);
            if (tokenOk && portraitOk) continue;

            const update = { _id: actor.id };

            if (!tokenOk) {
                const hints = this.hintsFromPath(src);
                if (!hints.ancestry) {
                    // Fall back to the actor's own ancestry when the path says nothing.
                    hints.ancestry = OpenAIImageGenerator.extractRace(actor) || "";
                }
                const replacement = await this.replacementFor(hints);
                update["prototypeToken.texture.src"] = replacement.src;
                update["prototypeToken.randomImg"] = replacement.randomImg;
                if (!replacement.randomImg) clearedOnly++;
            }

            if (!portraitOk) update.img = placeholderImage();

            updates.push(update);
        }

        if (updates.length) {
            await Actor.updateDocuments(updates);
            console.log(`${MODULE_ID} | Repaired token art on ${updates.length} actor(s)`);
        }

        if (notify) {
            if (!updates.length) {
                ui.notifications.info("NPC Randomizer: all token art resolved, nothing to repair.");
            } else if (clearedOnly) {
                ui.notifications.warn(
                    `NPC Randomizer: repaired ${updates.length} actor(s). ${clearedOnly} had no default art to point at, `
                    + "so they now use Foundry's mystery-man placeholder. Run \"Generate Default Tokens\" and repair "
                    + "again to give them real art.");
            } else {
                ui.notifications.info(`NPC Randomizer: repaired token art on ${updates.length} actor(s).`);
            }
        }

        return updates.length;
    }
}

/**
 * A dummy FormApplication exposing the repair sweep as a settings button.
 */
export class RepairTokensDummyApp extends FormApplication {
    /** @override @returns {Promise<RepairTokensDummyApp>} This instance. */
    async _render() {
        await DefaultTokens.repairWorldActors({ notify: true });
        return this;
    }
}

/**
 * A dummy FormApplication exposing default-token generation as a settings button.
 */
export class GenerateDefaultTokensDummyApp extends FormApplication {
    /** @override @returns {Promise<GenerateDefaultTokensDummyApp>} This instance. */
    async _render() {
        await DefaultTokens.generateDefaults({ notify: true });
        await DefaultTokens.repairWorldActors({ notify: true });
        return this;
    }
}

/**
 * A dummy FormApplication exposing the OpenAI connection test as a settings button.
 */
export class TestOpenAIDummyApp extends FormApplication {
    /** @override @returns {Promise<TestOpenAIDummyApp>} This instance. */
    async _render() {
        await OpenAIImageGenerator.testConnection({ notify: true });
        return this;
    }
}
