import { NPCRandomizerSettings, GenerateTablesDummyApp, GenerateNPCsDummyApp } from "./settings.js";

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
});

/**
 * Ready hook.
 * Checks if the initial generation of tables and NPCs has occurred for this world.
 * If not, it executes the generation once and marks the world as initialized.
 */
Hooks.once("ready", async () => {
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

    // Abort if nothing to update
    if (!newName && !newImg) return;

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

    if (app.options?.actions) {
        app.options.actions.copyToActorSidebar = () => copyActorToSidebar(actor, app);
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

