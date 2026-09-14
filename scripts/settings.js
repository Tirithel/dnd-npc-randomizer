import { DefaultTokens } from "./default-tokens.js";

/**
 * A dummy FormApplication that intercepts the rendering process to execute
 * the default table generation logic, then immediately closes itself.
 * Used for the "Generate Default Tables" button in the module settings.
 */
export class GenerateTablesDummyApp extends FormApplication {
    /**
     * Overrides the default render method to execute the generation logic.
     * @override
     * @param {boolean} force - Forces the rendering.
     * @param {Object} options - Additional rendering options.
     * @returns {Promise<GenerateTablesDummyApp>} The application instance.
     */
    async _render(force, options) {
        await NPCRandomizerSettings.generateDefaultTables();
        ui.notifications.info("NPC Randomizer: Default tables checked and generated!");
        return this;
    }
}

/**
 * A dummy FormApplication that intercepts the rendering process to execute
 * the default NPC import logic, then immediately closes itself.
 * Used for the "Generate Default NPCs" button in the module settings.
 */
export class GenerateNPCsDummyApp extends FormApplication {
    /**
     * Overrides the default render method to execute the import logic.
     * @override
     * @param {boolean} force - Forces the rendering.
     * @param {Object} options - Additional rendering options.
     * @returns {Promise<GenerateNPCsDummyApp>} The application instance.
     */
    async _render(force, options) {
        await NPCRandomizerSettings.generateDefaultNPCs();
        ui.notifications.info("NPC Randomizer: Pre-made NPCs imported!");
        return this;
    }
}

/**
 * Utility class containing the core logic for generating default RollTables 
 * and importing pre-made NPCs from the module's compendium.
 */
export class NPCRandomizerSettings {

    /**
     * Automatically creates a dedicated RollTable folder and populates it with 
     * default name tables (e.g., Human - Male, Elf - Female) by loading data 
     * from local JSON files.
     * 
     * @returns {Promise<void>}
     */
    static async generateDefaultTables() {
        const folderName = "NPC Name Randomizer";

        let folder = game.folders.find(f => f.name === folderName && f.type === "RollTable");

        if (!folder) {
            folder = await Folder.create({
                name: folderName,
                type: "RollTable"
            });
            console.log(`dnd-npc-randomizer | Created RollTable Folder: ${folderName}`);
        }

        // List of all default tables shipped in the /data folder
        const defaultTables = [
            "Human - Male", "Human - Female",
            "Dwarf - Male", "Dwarf - Female",
            "Elves - Male", "Elves - Female",
            "Tiefling - Male", "Tiefling - Female"
        ];

        for (const tableName of defaultTables) {
            const exists = game.tables.find(t => t.name === tableName && t.folder?.id === folder.id);
            if (!exists) {
                let results = [];

                // Construct the filename from the table name (e.g. "Human - Male" -> "human-male.json")
                const fileName = tableName.toLowerCase().replace(" - ", "-").replace(/ /g, "-") + ".json";
                const filePath = `modules/dnd-npc-randomizer/data/${fileName}`;

                try {
                    const response = await fetch(filePath);
                    if (response.ok) {
                        const names = await response.json();
                        if (Array.isArray(names)) {
                            // Create exactly 100 entries if possible, otherwise scale to the array length
                            results = names.map((nameStr, index) => ({
                                type: CONST.TABLE_RESULT_TYPES.TEXT,
                                name: nameStr,
                                weight: 1,
                                range: [index + 1, index + 1]
                            }));
                        }
                    }
                } catch (e) {
                    console.warn(`dnd-npc-randomizer | Could not load names from ${filePath}`, e);
                }

                // Fallback to formula 1d100 if empty, otherwise 1d[length]
                const maxRange = results.length > 0 ? results.length : 100;

                await RollTable.create({
                    name: tableName,
                    folder: folder.id,
                    formula: `1d${maxRange}`,
                    results: results
                });
                console.log(`dnd-npc-randomizer | Created RollTable: ${tableName}`);
            }
        }
    }

    /**
     * Imports pre-made NPCs from the module's included compendium pack.
     * It faithfully recreates the internal folder structure of the compendium 
     * inside the game world and populates it with the actors.
     * 
     * @returns {Promise<void>}
     */
    static async generateDefaultNPCs() {
        const rootFolderName = "Random NPCs";
        let rootFolder = game.folders.find(f => f.name === rootFolderName && f.type === "Actor" && !f.folder);

        if (!rootFolder) {
            rootFolder = await Folder.create({
                name: rootFolderName,
                type: "Actor"
            });
            console.log(`dnd-npc-randomizer | Created Root Actor Folder: ${rootFolderName}`);
        }

        const pack = game.packs.get("dnd-npc-randomizer.npc-compendium");
        if (!pack) {
            console.warn("dnd-npc-randomizer | No compendium pack found for NPCs.");
            ui.notifications.warn("Kein NPC Kompendium gefunden!");
            return;
        }

        // 1. Recreate Compendium Folder Structure in the World
        const compendiumFolders = pack.folders.contents;
        const folderMap = new Map(); // Maps Compendium Folder ID to World Folder ID

        /**
         * Recursively creates a matching world folder for a given compendium folder.
         * @param {Folder} cFolder - The folder document from the compendium.
         * @returns {Promise<string>} The ID of the newly created (or existing) world folder.
         */
        const createMappedFolder = async (cFolder) => {
            if (folderMap.has(cFolder.id)) return folderMap.get(cFolder.id);

            let parentId = rootFolder.id;
            const parentCFolderId = cFolder.folder?.id || cFolder.folder;

            if (parentCFolderId) {
                const parentCFolder = pack.folders.get(parentCFolderId);
                if (parentCFolder) {
                    parentId = await createMappedFolder(parentCFolder);
                }
            }

            let worldFolder = game.folders.find(f => f.name === cFolder.name && f.type === "Actor" && f.folder?.id === parentId);
            if (!worldFolder) {
                worldFolder = await Folder.create({
                    name: cFolder.name,
                    type: "Actor",
                    folder: parentId,
                    color: cFolder.color,
                    sorting: cFolder.sorting
                });
            }
            folderMap.set(cFolder.id, worldFolder.id);
            return worldFolder.id;
        };

        // Create all folders recursively
        for (const cFolder of compendiumFolders) {
            await createMappedFolder(cFolder);
        }

        // Import Actors into correct mapped folders
        const documents = await pack.getDocuments();

        for (const doc of documents) {
            let targetFolderId = rootFolder.id;
            const docFolderId = doc.folder?.id || doc.folder;

            if (docFolderId && folderMap.has(docFolderId)) {
                targetFolderId = folderMap.get(docFolderId);
            }

            const exists = game.actors.find(a => a.name === doc.name && a.folder?.id === targetFolderId);
            if (!exists) {
                const actorData = doc.toObject();
                actorData.folder = targetFolderId;

                // The bundled compendium points at the original author's own
                // image paths, which do not exist in a fresh install. Left
                // alone, the wildcard ones raise "Error retrieving wildcard
                // tokens" the moment the NPC is used.
                await DefaultTokens.repairActorData(actorData);

                await Actor.create(actorData);
                console.log(`dnd-npc-randomizer | Imported Actor: ${doc.name}`);
            }
        }
    }
}
