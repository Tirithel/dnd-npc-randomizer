/**
 * OpenAI-backed token art generation.
 *
 * Builds a prompt from an actor's ancestry and biography, asks the OpenAI
 * Images API for a portrait, writes the result into the Foundry data directory
 * and hands back a usable path.
 *
 * The API key lives in a *client*-scoped setting on purpose: Foundry pushes
 * world-scoped settings to every connected client, so a key stored there would
 * be readable by any player from the console.
 */

const MODULE_ID = "dnd-npc-randomizer";
const OPENAI_IMAGE_ENDPOINT = "https://api.openai.com/v1/images/generations";

/**
 * Resolves the FilePicker implementation across Foundry versions. The global
 * was deprecated in v13 in favour of the namespaced application.
 * @returns {typeof FilePicker} The active FilePicker class.
 */
function getFilePicker() {
    return foundry.applications?.apps?.FilePicker?.implementation
        ?? foundry.applications?.apps?.FilePicker
        ?? FilePicker;
}

export class OpenAIImageGenerator {

    /**
     * Reads the configured OpenAI API key.
     * @param {string} [override] - A key supplied programmatically, which wins.
     * @returns {string} The key, or an empty string when unset.
     */
    static getApiKey(override) {
        if (override) return override.trim();
        try {
            return (game.settings.get(MODULE_ID, "openaiApiKey") || "").trim();
        } catch (e) {
            return "";
        }
    }

    /**
     * Strips HTML down to readable text, for biography fields that hold markup.
     * @param {string} html - Raw HTML.
     * @param {number} [maxLength=600] - Truncation limit, to keep prompts small.
     * @returns {string} Plain text.
     */
    static htmlToText(html, maxLength = 600) {
        if (!html) return "";
        const div = document.createElement("div");
        div.innerHTML = html;
        const text = (div.textContent || div.innerText || "").replace(/\s+/g, " ").trim();
        return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
    }

    /**
     * Digs the ancestry out of an actor. dnd5e stores this differently for
     * characters (a Race item) and NPCs (a details string or creature type),
     * and the shape has moved between system versions, so every known location
     * is tried before giving up.
     *
     * @param {Actor} actor - The actor to inspect.
     * @returns {string} The ancestry name, or an empty string.
     */
    static extractRace(actor) {
        if (!actor) return "";

        // Characters (and 5e 3.x+ NPCs) carry ancestry as an owned Item.
        const raceItem = actor.items?.find?.(i => i.type === "race");
        if (raceItem?.name) return raceItem.name;

        const details = actor.system?.details ?? {};

        // Older/simple cases: a plain string on details.race.
        if (typeof details.race === "string" && details.race.trim()) return details.race.trim();
        if (details.race?.name) return details.race.name;

        // NPCs: fall back to creature type, e.g. "humanoid (goblinoid)".
        const type = details.type;
        if (typeof type === "string" && type.trim()) return type.trim();
        if (type?.value) {
            const subtype = type.subtype ? ` (${type.subtype})` : "";
            return `${type.value}${subtype}`;
        }

        return "";
    }

    /**
     * Pulls a descriptive blurb from an actor's biography.
     * @param {Actor} actor - The actor to inspect.
     * @returns {string} Plain-text description, possibly empty.
     */
    static extractDescription(actor) {
        if (!actor) return "";
        const bio = actor.system?.details?.biography ?? {};
        return this.htmlToText(bio.value || bio.public || "");
    }

    /**
     * Derives a gender hint from a name RollTable label such as
     * "Human - Female". Purely a hint; absent when the table says nothing.
     *
     * @param {string} tableName - The RollTable name.
     * @returns {string} "male", "female" or an empty string.
     */
    static extractGender(tableName) {
        if (!tableName) return "";
        const lower = String(tableName).toLowerCase();
        if (lower.includes("female")) return "female";   // checked first: "female" contains "male"
        if (lower.includes("male")) return "male";
        return "";
    }

    /**
     * Assembles the image prompt.
     *
     * @param {Object} options - Prompt inputs.
     * @param {string} [options.race] - Ancestry or creature type.
     * @param {string} [options.description] - Biography text.
     * @param {string} [options.gender] - Gender hint.
     * @param {string} [options.name] - Character name, used only for flavour.
     * @param {string} [options.style] - Art-direction suffix.
     * @returns {string} The finished prompt.
     */
    static buildPrompt({ race, description, gender, name, style } = {}) {
        const subject = [gender, race].filter(Boolean).join(" ") || "humanoid";
        const parts = [`A character portrait of a ${subject} from a fantasy tabletop roleplaying game.`];

        if (name) parts.push(`The character is named ${name}.`);
        if (description) parts.push(`Appearance and character notes: ${description}`);

        parts.push(style || OpenAIImageGenerator.defaultStyle());
        return parts.join(" ");
    }

    /**
     * The default art direction, framed for use as a VTT token.
     * @returns {string} Style guidance appended to every prompt.
     */
    static defaultStyle() {
        return "Head and shoulders, centred, facing the viewer, painterly digital fantasy art, "
            + "dramatic but even lighting, plain uncluttered background. "
            + "No text, no watermark, no border, no frame, a single character only.";
    }

    /**
     * Calls the OpenAI Images API.
     *
     * @param {Object} options - Request options.
     * @param {string} options.prompt - The image prompt.
     * @param {string} [options.apiKey] - Key override.
     * @param {string} [options.model] - Image model id.
     * @param {string} [options.size] - Pixel dimensions, e.g. "1024x1024".
     * @param {string} [options.quality] - Model-specific quality tier.
     * @returns {Promise<Uint8Array>} The raw PNG bytes.
     * @throws {Error} When the key is missing or the API reports a failure.
     */
    static async requestImage({ prompt, apiKey, model, size, quality } = {}) {
        const key = this.getApiKey(apiKey);
        if (!key) throw new Error("No OpenAI API key configured. Set one in the module settings.");

        const useModel = model || game.settings.get(MODULE_ID, "openaiImageModel");
        const body = {
            model: useModel,
            prompt: prompt,
            n: 1,
            size: size || game.settings.get(MODULE_ID, "openaiImageSize")
        };

        const useQuality = quality || game.settings.get(MODULE_ID, "openaiImageQuality");
        if (useQuality && useQuality !== "auto") body.quality = useQuality;

        // gpt-image-1 always returns base64 and rejects response_format;
        // the dall-e models need to be asked for it explicitly.
        if (useModel.startsWith("dall-e")) body.response_format = "b64_json";

        const response = await fetch(OPENAI_IMAGE_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${key}`
            },
            body: JSON.stringify(body)
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
            const message = payload?.error?.message || `HTTP ${response.status}`;
            throw new Error(`OpenAI image request failed: ${message}`);
        }

        const entry = payload?.data?.[0];
        if (!entry) throw new Error("OpenAI returned no image data.");

        if (entry.b64_json) return this.base64ToBytes(entry.b64_json);

        // dall-e-3 can hand back a URL instead when response_format is ignored.
        if (entry.url) {
            const imageResponse = await fetch(entry.url);
            if (!imageResponse.ok) throw new Error(`Could not download generated image: HTTP ${imageResponse.status}`);
            return new Uint8Array(await imageResponse.arrayBuffer());
        }

        throw new Error("OpenAI response contained neither b64_json nor url.");
    }

    /**
     * Decodes base64 into bytes.
     * @param {string} b64 - Base64 payload.
     * @returns {Uint8Array} Decoded bytes.
     */
    static base64ToBytes(b64) {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    }

    /**
     * Turns a label into a filesystem-safe slug.
     * @param {string} value - Arbitrary text.
     * @returns {string} A lowercase, hyphenated slug.
     */
    static slugify(value) {
        return String(value || "npc")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48) || "npc";
    }

    /**
     * Ensures the upload directory exists, creating intermediate segments.
     * @param {string} path - Directory path relative to the data root.
     * @returns {Promise<void>}
     */
    static async ensureDirectory(path) {
        const FP = getFilePicker();
        const segments = path.split("/").filter(Boolean);
        let current = "";
        for (const segment of segments) {
            current = current ? `${current}/${segment}` : segment;
            try {
                await FP.createDirectory("data", current);
            } catch (e) {
                // Already-exists is the expected outcome on every run but the first.
                if (!/exist/i.test(e?.message ?? "")) throw e;
            }
        }
    }

    /**
     * Expands placeholders in a configured directory path.
     *
     * `{world}` resolves to the active world id. Keeping art under
     * `worlds/<id>/` means it is included in a world export/backup and travels
     * with the world, which matters once a rolled scene token is promoted into
     * a permanent sidebar actor that references the file by path.
     *
     * @param {string} path - Raw configured path.
     * @returns {string} Path with placeholders resolved and slashes trimmed.
     */
    static resolveDirectory(path) {
        return String(path || "")
            .replace(/\{world\}/g, game.world?.id ?? "world")
            .replace(/^\/+|\/+$/g, "");
    }

    /**
     * Writes image bytes into the Foundry data directory.
     *
     * The file is uploaded to the server's data area rather than held as a
     * blob URL, so every connected client can load it and the reference stays
     * valid across restarts.
     *
     * @param {Uint8Array} bytes - PNG bytes.
     * @param {string} baseName - Name used to build the filename.
     * @param {string} [directory] - Target directory; defaults to the setting.
     * @returns {Promise<string>} The stored file's path.
     */
    static async saveImage(bytes, baseName, directory) {
        const FP = getFilePicker();
        const configured = directory || game.settings.get(MODULE_ID, "openaiImagePath");
        const dir = this.resolveDirectory(configured) || `worlds/${game.world?.id ?? "world"}/npc-randomizer`;

        await this.ensureDirectory(dir);

        // Timestamp keeps repeat generations for the same NPC from colliding.
        const fileName = `${this.slugify(baseName)}-${Date.now()}.png`;
        const file = new File([bytes], fileName, { type: "image/png" });

        const result = await FP.upload("data", dir, file, {}, { notify: false });
        if (!result?.path) throw new Error("Upload succeeded but returned no path.");
        return result.path;
    }

    /**
     * Generates and stores a portrait for an actor.
     *
     * This is the entry point intended for programmatic use:
     *   const api = game.modules.get("dnd-npc-randomizer").api;
     *   await api.generateImageForActor({ actor, apiKey: "sk-..." });
     *
     * @param {Object} options - Generation options.
     * @param {Actor} [options.actor] - Actor supplying race and description.
     * @param {string} [options.race] - Explicit ancestry, overriding the actor.
     * @param {string} [options.description] - Explicit description, overriding the actor.
     * @param {string} [options.gender] - Gender hint.
     * @param {string} [options.name] - Name used for the prompt and filename.
     * @param {string} [options.prompt] - A complete prompt, bypassing assembly.
     * @param {string} [options.apiKey] - Key override.
     * @param {string} [options.model] - Model override.
     * @param {string} [options.size] - Size override.
     * @param {string} [options.quality] - Quality override.
     * @param {string} [options.style] - Style override.
     * @param {string} [options.directory] - Output directory override.
     * @returns {Promise<{path: string, prompt: string}>} Stored path and prompt used.
     */
    static async generateImageForActor(options = {}) {
        const { actor, prompt, apiKey, model, size, quality, style, directory } = options;

        const race = options.race ?? this.extractRace(actor);
        const description = options.description ?? this.extractDescription(actor);
        const name = options.name ?? actor?.name ?? "NPC";
        const gender = options.gender ?? "";

        const finalPrompt = prompt || this.buildPrompt({ race, description, gender, name, style });

        console.log(`${MODULE_ID} | Requesting image for "${name}" | prompt: ${finalPrompt}`);

        const bytes = await this.requestImage({ prompt: finalPrompt, apiKey, model, size, quality });
        const path = await this.saveImage(bytes, name, directory);

        console.log(`${MODULE_ID} | Stored generated image at ${path}`);
        return { path, prompt: finalPrompt };
    }
}
