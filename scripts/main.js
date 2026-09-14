import { NPCRandomizerSettings, GenerateTablesDummyApp, GenerateNPCsDummyApp } from "./settings.js";
import { OpenAIImageGenerator } from "./openai-image.js";

/**
 * Initialize module.
 * Registers the game settings menus and variables needed for the module.
 */
Hooks.once("init", () => {
    console.log("dnd-npc-randomizer | Initializing module");

    // Register a dummy menu button for generating default RollTables
    game.settings.registerMenu("dnd-npc-randomizer", "generateTablesMenu", {
        name: "Generate Default Tables",
        label: "Import RollTables",
        hint: "Manually generation of Pre-Made Rolltables.",
        type: GenerateTablesDummyApp,
        restricted: true
    });

    // Register a dummy menu button for importing pre-made NPCs
    game.settings.registerMenu("dnd-npc-randomizer", "generateNPCsMenu", {
        name: "Generate Default NPCs",
        label: "Import NPCs",
        hint: "Manually generation of Pre-Made NPCs.",
        type: GenerateNPCsDummyApp,
        restricted: true
    });

    // Register an internal, hidden setting to track if the initial generation has run
    game.settings.register("dnd-npc-randomizer", "initialized", {
        name: "Initialized",
        scope: "world",
        config: false,
        type: Boolean,
        default: false
    });

    // --- OpenAI token art -------------------------------------------------

    // Client scope is deliberate. Foundry replicates world-scoped settings to
    // every connected client, so a key stored world-side would be readable by
    // any player from the console. Client scope keeps it in this browser only,
    // which does mean each GM enters their own key per browser.
    game.settings.register("dnd-npc-randomizer", "openaiApiKey", {
        name: "OpenAI API Key",
        hint: "Stored only in this browser, never sent to other players. Leave blank to disable image generation.",
        scope: "client",
        config: true,
        type: String,
        default: ""
    });

    game.settings.register("dnd-npc-randomizer", "openaiImageEnabled", {
        name: "Generate Token Art on Drop",
        hint: "When a randomized NPC is dropped on a scene, generate a portrait from its ancestry and description. Each token costs an OpenAI image call, so this is off by default.",
        scope: "world",
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register("dnd-npc-randomizer", "openaiImageModel", {
        name: "Image Model",
        hint: "OpenAI model used for generation.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            "gpt-image-1": "gpt-image-1",
            "dall-e-3": "dall-e-3"
        },
        default: "gpt-image-1"
    });

    game.settings.register("dnd-npc-randomizer", "openaiImageSize", {
        name: "Image Size",
        hint: "Square suits tokens best.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            "1024x1024": "1024 x 1024 (square)",
            "1024x1536": "1024 x 1536 (portrait)",
            "1536x1024": "1536 x 1024 (landscape)"
        },
        default: "1024x1024"
    });

    game.settings.register("dnd-npc-randomizer", "openaiImageQuality", {
        name: "Image Quality",
        hint: "Higher quality costs more per image.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            "auto": "Auto",
            "low": "Low",
            "medium": "Medium",
            "high": "High"
        },
        default: "medium"
    });

    game.settings.register("dnd-npc-randomizer", "openaiImageStyle", {
        name: "Art Direction",
        hint: "Appended to every prompt. Leave blank to use the built-in token-framing style.",
        scope: "world",
        config: true,
        type: String,
        default: ""
    });

    // Under worlds/<id>/ so generated art is captured by a world export and
    // keeps working when a dropped token is promoted to a permanent actor.
    game.settings.register("dnd-npc-randomizer", "openaiImagePath", {
        name: "Image Storage Path",
        hint: "Where generated art is uploaded, relative to the Foundry data directory. {world} expands to the current world id.",
        scope: "world",
        config: true,
        type: String,
        default: "worlds/{world}/npc-randomizer"
    });

    game.settings.register("dnd-npc-randomizer", "openaiImageApplyTo", {
        name: "Apply Generated Art To",
        hint: "Whether new art replaces the map token, the character sheet portrait, or both.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            "both": "Token and portrait",
            "token": "Map token only",
            "portrait": "Character sheet portrait only"
        },
        default: "both"
    });
});

/**
 * Ready hook.
 * Checks if the initial generation of tables and NPCs has occurred for this world.
 * If not, it executes the generation once and marks the world as initialized.
 */
Hooks.once("ready", async () => {
    // Public API, so art can be generated from macros or scripts:
    //   const api = game.modules.get("dnd-npc-randomizer").api;
    //   await api.generateImageForActor({ actor, apiKey: "sk-..." });
    //   await api.applyGeneratedImage({ actor });
    const module = game.modules.get("dnd-npc-randomizer");
    if (module) {
        module.api = {
            generateImageForActor: OpenAIImageGenerator.generateImageForActor.bind(OpenAIImageGenerator),
            applyGeneratedImage: applyGeneratedImage,
            buildPrompt: OpenAIImageGenerator.buildPrompt.bind(OpenAIImageGenerator),
            extractRace: OpenAIImageGenerator.extractRace.bind(OpenAIImageGenerator),
            extractDescription: OpenAIImageGenerator.extractDescription.bind(OpenAIImageGenerator),
            copyActorToSidebar: copyActorToSidebar,
            OpenAIImageGenerator: OpenAIImageGenerator
        };
    }

    // Erstelle die Standard-Tabellen und importiere NPCs nur einmalig bei der ersten Aktivierung/Initialisierung
    if (game.user.isGM) {
        const isInitialized = game.settings.get("dnd-npc-randomizer", "initialized");
        if (!isInitialized) {
            await NPCRandomizerSettings.generateDefaultTables();
            await NPCRandomizerSettings.generateDefaultNPCs();
            await game.settings.set("dnd-npc-randomizer", "initialized", true);
        }
    }
});

/**
 * Injects custom configuration HTML into the Token Config window.
 * Adds a dropdown to select a RollTable for automatic NPC name generation.
 * 
 * @param {Application} app - The Foundry VTT Application instance being rendered.
 * @param {jQuery|HTMLElement} html - The HTML element of the rendered application.
 * @param {Object} data - Context data provided to the application template.
 */
const injectTokenConfig = async (app, html, data) => {
    // 3. This setting should NOT be displayed on already placed tokens (on the scene)
    if (!app.isPrototype) return;

    let element = html;
    if (typeof jQuery !== "undefined" && element instanceof jQuery) {
        element = element[0];
    } else if (!element && app.element) {
        element = (typeof jQuery !== "undefined" && app.element instanceof jQuery) ? app.element[0] : app.element;
    }

    if (!element) return;

    // Use a short timeout to ensure the DOM is fully constructed before injecting
    setTimeout(async () => {
        const form = element.querySelector('form') || element;

        // Prevent double injection
        if (form.querySelector('.dnd-npc-randomizer-group')) return;

        // Is this a token config? Look for characteristic fields to attach our UI
        let linkActorInput = form.querySelector('[name="actorLink"], [name="document.actorLink"], [name="client.actorLink"], [name="flags.actorLink"]');
        let displayNameInput = form.querySelector('[name="name"], [name="displayName"], [name="document.name"], [name="document.displayName"]');
        let identityTab = form.querySelector('.tab[data-tab="character"], .tab[data-tab="identity"], section[data-tab="identity"], fieldset.identity');

        if (!linkActorInput && !displayNameInput && !identityTab) {
            return;
        }

        let linkActorGroup = null;
        if (linkActorInput) {
            linkActorGroup = linkActorInput.closest('.form-group, form-group, fieldset');
        }
        if (!linkActorGroup && displayNameInput) {
            linkActorGroup = displayNameInput.closest('.form-group, form-group, fieldset');
        }
        if (!linkActorGroup && identityTab) {
            linkActorGroup = identityTab;
        }
        if (!linkActorGroup) {
            linkActorGroup = form;
        }

        // Retrieve RollTables from the configured target folder
        const folderName = "NPC Name Randomizer";
        const folder = game.folders.find(f => f.name === folderName && f.type === "RollTable");
        let tables = folder ? game.tables.filter(t => t.folder?.id === folder.id) : [];

        // Ensure alphabetical sorting of the tables
        tables.sort((a, b) => a.name.localeCompare(b.name));

        let currentTableId = "";

        // Try getting the flag from various possible locations depending on Foundry version and context
        if (app.token && typeof app.token.getFlag === "function") {
            currentTableId = app.token.getFlag("dnd-npc-randomizer", "nameRollTable");
        }
        if (!currentTableId && app.document && typeof app.document.getFlag === "function") {
            currentTableId = app.document.getFlag("dnd-npc-randomizer", "nameRollTable");
        }
        if (!currentTableId && app.actor) {
            currentTableId = foundry.utils.getProperty(app.actor, "prototypeToken.flags.dnd-npc-randomizer.nameRollTable");
        }
        if (!currentTableId && app.object) { // Fallback for older V11 applications
            if (app.object.prototypeToken) {
                currentTableId = foundry.utils.getProperty(app.object, "prototypeToken.flags.dnd-npc-randomizer.nameRollTable");
            } else if (typeof app.object.getFlag === "function") {
                currentTableId = app.object.getFlag("dnd-npc-randomizer", "nameRollTable");
            }
        }

        currentTableId = currentTableId || "";

        // Prepare context data for the Handlebars template
        const templateData = {
            tables: tables.map(t => ({
                id: t.id,
                name: t.name,
                // Check if the current saved flag matches the table's name or its legacy ID
                selected: t.name === currentTableId || t.id === currentTableId
            }))
        };

        const templateContent = await renderTemplate("modules/dnd-npc-randomizer/templates/token-config.hbs", templateData);

        // Inject the parsed HTML into the DOM
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = templateContent;
        const injectedGroup = tempDiv.firstElementChild;

        if (linkActorGroup && linkActorGroup.parentNode && linkActorGroup !== form && linkActorGroup !== identityTab) {
            linkActorGroup.parentNode.insertBefore(injectedGroup, linkActorGroup);
        } else if (linkActorGroup) {
            linkActorGroup.appendChild(injectedGroup);
        }

        // 2. Disable logic: When "Link Actor Data" is checked, set Name Randomizer to "-- None --"
        const select = injectedGroup.querySelector('select');

        // Track the pending value on the app instance so we can inject it on save
        select.addEventListener("change", (event) => {
            app._dndPendingRollTable = event.target.value;
        });

        if (linkActorInput && select) {
            const toggleDisabled = () => {
                const isLinked = linkActorInput.checked === undefined ? linkActorInput.hasAttribute('checked') : linkActorInput.checked;
                select.disabled = isLinked;
                if (isLinked) {
                    select.value = ""; // Reset dropdown to "-- None --"
                    app._dndPendingRollTable = "";
                }
            };
            linkActorInput.addEventListener("change", toggleDisabled);
            setTimeout(toggleDisabled, 10); // Ensure initial state is applied
        }
    }, 150);
};

// Register hooks to catch different types of token configuration windows across Foundry versions
Hooks.on("renderApplication", injectTokenConfig);
Hooks.on("renderDocumentSheet", injectTokenConfig);
Hooks.on("renderTokenConfig", injectTokenConfig);
Hooks.on("renderPrototypeTokenConfig", injectTokenConfig);

/**
 * Pre-update hook for Actors.
 * Injects the temporarily stored RollTable selection flag into the database update when the user clicks Save.
 */
Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
    if (actor.apps) {
        for (const app of Object.values(actor.apps)) {
            if (app._dndPendingRollTable !== undefined) {
                foundry.utils.setProperty(changes, "prototypeToken.flags.dnd-npc-randomizer.nameRollTable", app._dndPendingRollTable);
                delete app._dndPendingRollTable;
            }
        }
    }
});

/**
 * Pre-update hook for Tokens.
 * Injects the temporarily stored RollTable selection flag into the database update when the user clicks Save.
 */
Hooks.on("preUpdateToken", (token, changes, options, userId) => {
    if (token.apps) {
        for (const app of Object.values(token.apps)) {
            if (app._dndPendingRollTable !== undefined) {
                foundry.utils.setProperty(changes, "flags.dnd-npc-randomizer.nameRollTable", app._dndPendingRollTable);
                delete app._dndPendingRollTable;
            }
        }
    }
});

/**
 * Generates token art via OpenAI and writes it onto a token and/or its actor.
 *
 * The uploaded file lives in the Foundry data directory, so the reference is a
 * normal server path: it survives a restart, loads for every connected client,
 * and remains valid when the scene token is later promoted into a permanent
 * world actor via "Copy to Actor Sidebar".
 *
 * @param {Object} options - Options.
 * @param {TokenDocument} [options.token] - Placed token to update.
 * @param {Actor} [options.actor] - Actor to read race/description from.
 * @param {string} [options.gender] - Gender hint for the prompt.
 * @param {string} [options.applyTo] - "token", "portrait" or "both".
 * @param {string} [options.apiKey] - API key override.
 * @param {boolean} [options.notify=true] - Whether to surface UI notifications.
 * @returns {Promise<string|null>} The stored image path, or null on failure.
 */
export async function applyGeneratedImage({ token, actor, gender, applyTo, apiKey, notify = true } = {}) {
    const targetActor = actor ?? token?.actor;
    if (!targetActor) return null;

    const key = OpenAIImageGenerator.getApiKey(apiKey);
    if (!key) {
        if (notify) ui.notifications.warn("NPC Randomizer: no OpenAI API key configured.");
        return null;
    }

    const name = token?.name || targetActor.name || "NPC";
    let info;

    if (notify) ui.notifications.info(`NPC Randomizer: generating art for "${name}"...`);

    try {
        info = await OpenAIImageGenerator.generateImageForActor({
            actor: targetActor,
            name: name,
            gender: gender,
            apiKey: key
        });
    } catch (error) {
        console.error("dnd-npc-randomizer | Image generation failed:", error);
        if (notify) ui.notifications.error(`NPC Randomizer: ${error.message}`);
        return null;
    }

    const mode = applyTo || game.settings.get("dnd-npc-randomizer", "openaiImageApplyTo");
    const wantsToken = mode === "both" || mode === "token";
    const wantsPortrait = mode === "both" || mode === "portrait";

    // Recorded on the document so the path survives promotion to a world actor
    // and so a regenerated NPC can be told apart from hand-picked art.
    const flagUpdates = {
        "flags.dnd-npc-randomizer.generatedImage": info.path,
        "flags.dnd-npc-randomizer.generatedPrompt": info.prompt
    };

    if (token) {
        const updates = { ...flagUpdates };
        if (wantsToken) updates["texture.src"] = info.path;
        if (wantsPortrait) updates["delta.img"] = info.path;
        await token.update(updates);
    } else {
        const updates = { ...flagUpdates };
        if (wantsPortrait) updates.img = info.path;
        if (wantsToken) updates["prototypeToken.texture.src"] = info.path;
        await targetActor.update(updates);
    }

    if (notify) ui.notifications.info(`NPC Randomizer: art generated for "${name}".`);
    return info.path;
}

/**
 * Token creation hook.
 * Processes random name generation and dynamic portrait assignment
 * when a new token is dragged onto the scene.
 */
Hooks.on("createToken", async (token, options, userId) => {
    // Only the user executing the creation should process the generation logic
    if (game.user.id !== userId) return;

    // Feature is restricted to unlinked actors (prototypes)
    if (token.actorLink) return;

    // 1. Fetch table flag from the token (copied from prototype)
    let tableId = token.getFlag("dnd-npc-randomizer", "nameRollTable");

    // 2. Aggressive Fallback: If not found on token, read directly from the Actor
    if (!tableId && token.actor) {
        tableId = foundry.utils.getProperty(token.actor, "prototypeToken.flags.dnd-npc-randomizer.nameRollTable");
    }

    let newImg = undefined;
    let newName = undefined;

    // Feature A: Portrait Image Matching (Parallel "Portraits" folder, exact same filename)
    const currentImg = token.texture?.src || token._source?.texture?.src;
    if (currentImg && currentImg.includes("/Tokens/")) {
        const expectedPortraitPath = currentImg.replace("/Tokens/", "/Portraits/");

        try {
            // Perform a fast HEAD request to check if the file actually exists on the server
            const response = await fetch(expectedPortraitPath, { method: "HEAD" });
            if (response.ok) {
                newImg = expectedPortraitPath;
            }
        } catch (error) {
            console.warn("dnd-npc-randomizer | Could not verify portrait image:", error);
        }
    }

    // Feature B: Random Name assignment
    if (tableId) {
        let table = game.tables.get(tableId);

        const configuredFolder = "NPC Name Randomizer";

        // If not found by ID (or if the stored flag is actually the string Name), try finding it by name in the configured folder
        if (!table) {
            const folder = game.folders.find(f => f.name === configuredFolder && f.type === "RollTable");
            if (folder) {
                table = game.tables.find(t => t.name === tableId && t.folder?.id === folder.id);
            }
        }

        // Ensure the table actually belongs to the currently configured folder
        // so we don't accidentally use old ghost references if the folder was changed.
        if (table && table.folder?.name === configuredFolder) {
            try {
                // Await the table roll to get a random name.
                const rollData = await table.roll({ async: true });
                if (rollData && rollData.results && rollData.results.length > 0) {
                    // Handle different TableResult structures across Foundry versions (V12, V13, V14)
                    const res = rollData.results[0];
                    newName = res.name || res.text || (typeof res.get === "function" ? res.get("text") : undefined);
                }
            } catch (e) {
                console.error("dnd-npc-randomizer | Table roll error:", e);
            }
        }
    }

    // Prepare a single comprehensive database update object
    const updates = {};

    if (newName) {
        updates.name = newName;         // Updates the Map Label
        updates["delta.name"] = newName; // Updates the Character Sheet Name
    }

    if (newImg) {
        updates["delta.img"] = newImg;   // Updates the Character Sheet Portrait
        // Explicitly force the token image to remain its current image to prevent
        // the game system (e.g. D&D 5e) from auto-syncing the map token to the new portrait!
        updates["texture.src"] = currentImg;
    }

    if (Object.keys(updates).length > 0) {
        await token.update(updates);

        // Provide visual UI feedback to the GM
        if (newName) {
            ui.notifications.info(`NPC Randomizer: Token renamed to "${newName}"`);
        }
    }

    // Feature C: OpenAI-generated art, only when the parallel-folder lookup
    // above found nothing. Curated art therefore always wins, and no image
    // call is billed for an NPC that already has a portrait.
    const aiEnabled = game.settings.get("dnd-npc-randomizer", "openaiImageEnabled");
    if (aiEnabled && !newImg && game.user.isGM) {
        // The name was just rolled, so the prompt and filename can use it, and
        // the table label ("Human - Female") is the only gender hint available.
        const genderHint = OpenAIImageGenerator.extractGender(
            typeof tableId === "string" ? tableId : game.tables.get(tableId)?.name
        );

        await applyGeneratedImage({ token, gender: genderHint });
    }
});

/**
 * Copies an actor (particularly a placed synthetic token actor) to the World Actor Sidebar.
 * If an actor with the same name already exists in the sidebar, appends a (Copy) suffix.
 * Automatically closes the character sheet once copied.
 * 
 * @param {Actor} actor - The Actor document to copy.
 * @param {Application} [app] - The open application / character sheet to close.
 * @returns {Promise<Actor>} The newly created World Actor.
 */
export async function copyActorToSidebar(actor, app) {
    if (!actor) return;
    if (!game.user.can("ACTOR_CREATE")) {
        ui.notifications.warn("You do not have permission to create Actors.");
        return;
    }

    const baseName = actor.name || "New Actor";
    let targetName = baseName;

    // If an actor with this name already exists in the World Actor collection, append (Copy)
    if (game.actors.some(a => a.name === targetName)) {
        const copyOf = game.i18n.format("DOCUMENT.CopyOf", { name: targetName }) || `${targetName} (Copy)`;
        targetName = copyOf;
        while (game.actors.some(a => a.name === targetName)) {
            targetName = game.i18n.format("DOCUMENT.CopyOf", { name: targetName }) || `${targetName} (Copy)`;
        }
    }

    // Export actor data and strip database ID
    const actorData = actor.toObject();
    delete actorData._id;
    actorData.name = targetName;

    actorData.prototypeToken = actorData.prototypeToken || {};
    actorData.prototypeToken.actorLink = true;

    // For token actors: bake in the current token appearance and prevent re-randomization
    if (actor.isToken || actor.token) {
        actorData.prototypeToken.name = targetName;
        if (actor.token?.texture?.src) {
            actorData.prototypeToken.texture = actorData.prototypeToken.texture || {};
            actorData.prototypeToken.texture.src = actor.token.texture.src;
        }
        actorData.prototypeToken.randomImg = false;
        // Clear nameRollTable so dragging this specific actor doesn't overwrite its name
        foundry.utils.setProperty(actorData, "prototypeToken.flags.dnd-npc-randomizer.nameRollTable", "");

        // Carry generated art across explicitly. The uploaded file already lives
        // in the data directory, so the permanent actor just keeps pointing at
        // it; without this the sheet portrait can fall back to the base actor's
        // image and the generated PNG is orphaned on disk.
        const generated = actor.token?.getFlag?.("dnd-npc-randomizer", "generatedImage")
            ?? foundry.utils.getProperty(actor, "token.flags.dnd-npc-randomizer.generatedImage");

        if (generated) {
            foundry.utils.setProperty(actorData, "flags.dnd-npc-randomizer.generatedImage", generated);
            const prompt = actor.token?.getFlag?.("dnd-npc-randomizer", "generatedPrompt");
            if (prompt) foundry.utils.setProperty(actorData, "flags.dnd-npc-randomizer.generatedPrompt", prompt);
        }

        // actor.img on a synthetic token actor already reflects delta.img, but
        // pin it so the copy cannot regress to the prototype's portrait.
        if (actor.img) actorData.img = actor.img;
    }

    // Always place the newly copied actor at the root level of the sidebar (no folder)
    actorData.folder = null;

    try {
        const created = await Actor.create(actorData);

        // If this actor was on the scene, link the placed token to the new World Actor
        const tokenDoc = actor.isToken ? (actor.token || actor.parent) : null;
        if (tokenDoc && typeof tokenDoc.update === "function") {
            const tokenUpdates = {
                actorId: created.id,
                actorLink: true,
                name: created.name
            };
            if (tokenDoc.texture?.src) {
                tokenUpdates["texture.src"] = tokenDoc.texture.src;
            }
            await tokenDoc.update(tokenUpdates);
        }

        // Automatically close the character sheet
        if (app && typeof app.close === "function") {
            await app.close({ submit: false });
        }
        if (actor.apps) {
            for (const openApp of Object.values(actor.apps)) {
                if (openApp !== app && typeof openApp.close === "function") {
                    await openApp.close({ submit: false });
                }
            }
        }

        ui.notifications.info(`NPC Randomizer: "${created.name}" copied to Actor Sidebar.`);
        return created;
    } catch (err) {
        console.error("dnd-npc-randomizer | Failed to copy actor to sidebar:", err);
        ui.notifications.error(`Failed to copy actor: ${err.message}`);
    }
}

// ApplicationV2 Header Controls (Foundry v12 / v13 / v14)
Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
    const actor = app.actor || app.document;
    if (!actor || actor.documentName !== "Actor") return;
    if (controls.some(c => c.action === "copyToActorSidebar")) return;

    controls.push({
        icon: "fa-solid fa-user-plus",
        label: "Copy to Actor Sidebar",
        action: "copyToActorSidebar",
        visible: () => game.user.can("ACTOR_CREATE"),
        onClick: () => copyActorToSidebar(actor, app)
    });

    // Manual generation, so art can be made (or remade) for any actor without
    // waiting for a drop onto a scene.
    controls.push({
        icon: "fa-solid fa-wand-magic-sparkles",
        label: "Generate Token Art",
        action: "generateTokenArt",
        visible: () => game.user.isGM && !!OpenAIImageGenerator.getApiKey(),
        onClick: () => applyGeneratedImage({ actor: actor, token: actor.token ?? null })
    });

    if (app.options?.actions) {
        app.options.actions.copyToActorSidebar = () => copyActorToSidebar(actor, app);
        app.options.actions.generateTokenArt = () => applyGeneratedImage({ actor: actor, token: actor.token ?? null });
    }
});

// ApplicationV1 Header Buttons (Fallback for legacy sheets)
Hooks.on("getActorSheetHeaderButtons", (app, buttons) => {
    const actor = app.actor || app.document || app.object;
    if (!actor) return;
    if (buttons.some(b => b.class === "copy-to-actor-sidebar")) return;

    buttons.push({
        label: "Copy to Actor Sidebar",
        class: "copy-to-actor-sidebar",
        icon: "fas fa-user-plus",
        onclick: () => copyActorToSidebar(actor, app)
    });
});

