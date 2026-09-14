# DnD NPC Randomizer

A Foundry VTT module (compatible with v14+) for the automatic and random generation of NPC names and the dynamic assignment of portraits for the D&D 5e system. Ideal for Game Masters who want to quickly drag and drop individual NPCs onto the map with fitting names and portraits.

## Features

* **Random Names via RollTables**: Assign a RollTable to an NPC's prototype token. As soon as the NPC is dragged onto the scene (as an "unlinked" token), a name is automatically rolled from the table and assigned.
* **Automatic Portrait**: When a token is dragged onto the map, the module searches for a corresponding portrait image in a parallel `Portraits` folder. For example, if your token image is located at `Images/Tokens/Goblin_01.png`, the module checks if an image with the exact same name exists at `Images/Portraits/Goblin_01.png` and automatically sets this as the character portrait in the actor sheet, without changing the token image on the map.
* **Dynamic Token Settings**: In the Token settings (under the "Identity" tab), the module adds a dropdown menu where you can directly select the desired name table for this NPC.
* **Smart Linking**: The module is explicitly designed for unlinked tokens. As soon as "Link Actor Data" is activated in the token settings, the name assignment is automatically disabled.
* **Copy to Actor Sidebar**: Turn any dynamically rolled scene NPC into a permanent, linked world actor with a single click. In the sheet's header controls menu, click "Copy to Actor Sidebar" to create a permanent sidebar actor with "Link Actor Data" enabled, link the placed scene token directly to it (sharing the exact same UUID), and preserve its current rolled token image.
* **Included Default Content**: Default name tables (Human, Dwarf, Elf, Tiefling, etc.) can be generated via the module settings, and a rich compendium of over 400 pre-made NPCs organized into categories (*Townsfolk*, *Guards & Warriors*, *Spellcasters & Faith*, *Cultists*) can be imported directly into the game world.

## Installation

### Recommended
1. Open Foundry VTT and go to the **Add-on Modules** tab.
2. Click **Install Module** and search for **DnD NPC Randomizer**.
3. Click Install.
4. Launch your world and enable the module in the "Manage Modules" menu.

### Manual Installation (Alternative)
1. Create a new folder named exactly `dnd-npc-randomizer` inside your Foundry VTT `Data/modules/` directory.
2. Extract/copy all the downloaded contents from GitHub directly into this newly created folder.
3. Restart Foundry VTT.
4. Enable the module in the "Manage Modules" menu of your world.

## Usage

### 1. Preparing Name Tables
As soon as the module is activated for the first time (or manually via the module settings), it automatically generates the **"NPC Name Randomizer"** folder in the RollTable tab and populates it with default tables for various ancestries.
* **Expanding**: You can create your own tables in this folder at any time. The module automatically detects all tables located in this folder and offers them for selection in the token's dropdown menu.

### 2. Configuring Tokens
1. Open the character sheet of any actor and go to the **Prototype Token** settings.
2. Ensure that **Link Actor Data** is *not* activated.
3. Under the **Identity** tab, you will find the new dropdown menu for the **NPC Name Randomizer**.
4. Select one of the tables (e.g., "Human - Male", "Tiefling - Female") and click Save.

### 3. Dragging to the Scene
Drag the configured actor from the sidebar onto the scene.
* The newly created token on the map (and its actor data) will immediately be assigned a random name from the RollTable.
* At the same time, the module will search for a corresponding portrait for this token (as described under Features) and assign it as the image in the character sheet.
* The Game Master receives a short UI notification about the newly assigned name.

### 4. Saving Scene NPCs to Sidebar ("Copy to Actor Sidebar")
When a randomly generated scene token becomes an important or recurring NPC:
1. Open the character sheet of the token on the map.
2. Click the window controls menu in the sheet header (where *Configure Sheet*, *Configure Ownership*, etc. are located).
3. Select **"Copy to Actor Sidebar"** at the bottom of the menu.
4. The actor is copied into your world's Actor Sidebar with **Link Actor Data** activated and its current rolled token texture preserved.
5. The placed token on the scene is automatically linked to this new world actor, sharing the exact same UUID so HP and stat changes synchronize across map and sheet.
6. If an actor with that name already exists in the sidebar, `(Copy)` is automatically appended.
7. The character sheet closes automatically after copying.

### 5. Module Settings & Compendium
In the game settings, under the **Module Settings** tab, you will find two specific sections for the *DnD NPC Randomizer*:
* **Generate Default Tables**: Contains the "Import RollTables" button, which checks the table folder and restores any accidentally deleted default tables.
* **Generate Default NPCs**: Contains the "Import NPCs" button, which imports the included pre-made NPCs from the module's compendium (*Lidarion - Random NPCs*), along with their hierarchical folder structure, into your active world.

## Notes

* This module is specifically designed for the **D&D 5e** system (although the main features could potentially work in other systems, provided they use the same standard token structures).
* **Portrait Folder Structure**: For the automatic portrait feature to work, you must structure your image files into parallel folders named `Tokens` and `Portraits`. The filename must be identical in both folders. Example: A token image located at `.../Tokens/Goblin_01.png` requires a portrait image located at `.../Portraits/Goblin_01.png`.

## AI Token Art (OpenAI)

The module can generate a portrait for an NPC from its **ancestry** and **biography** using the OpenAI Images API.

### Setup

1. Create an API key at <https://platform.openai.com/api-keys>.
2. Open **Configure Settings → DnD NPC Randomizer** and paste it into **OpenAI API Key**.
3. Tick **Generate Token Art on Drop**.

> **Why the key is per-browser.** Foundry replicates `world`-scoped settings to every connected client, so a key stored world-side would be readable by any player from the browser console. This setting is `client`-scoped, so the key never leaves the GM's browser — the trade-off is that each GM enters it once per browser, and it does not sync between machines.

### First run

1. **Test OpenAI Connection** — runs one throwaway generation and reports exactly which stage failed. Worth doing first: a missing key, an unverified organisation, an exhausted quota and a blocked upload all look identical otherwise, i.e. no image appears.
2. **Generate Default Tokens** — generates one reusable default per ancestry and gender, then repairs any NPC with no valid art.
3. **Repair Token Images** — sweeps the world for unresolvable token and portrait paths. Makes no OpenAI calls, so it is free to run any time.

> **`gpt-image-1` requires OpenAI organisation verification.** Unverified accounts get a 403. The module detects this and retries once with `dall-e-3`, telling you it has done so.

### Fixing "Error retrieving wildcard tokens"

The bundled compendium ships prototype tokens pointing at the original author's install — a wildcard under `assets/dnd-npc-randomizer/` resolved from the **Foundry data root** (not from inside this module), plus `worlds/lidarion/...` and `tokenizer/_cache/...` images. None of those exist in a fresh install, so Foundry fails the wildcard lookup and raises that error.

Imported NPCs are now repaired automatically as they are created, and **Repair Token Images** fixes worlds that already contain them. Where no default art has been generated yet, the reference is repointed at Foundry's own `icons/svg/mystery-man.svg` rather than left as an unresolvable wildcard — that wildcard is precisely what raises the error, and a path that always exists renders predictably in its place.

### When art is generated

Art is generated on drop **only when the existing parallel-folder portrait lookup finds nothing**. Curated art therefore always wins, and no image call is billed for an NPC that already has a portrait.

Name rolling and the portrait swap apply to **unlinked** tokens only, as before. Art generation applies to both — a linked actor promoted via "Copy to Actor Sidebar" still gets a portrait.

You can also generate on demand: open any actor sheet and choose **Generate Token Art** from the header controls menu. This works for actors that were never dropped on a scene, and re-running it replaces the art.

### Where the files go

Generated PNGs are uploaded into the Foundry data directory — not held as blob URLs — so the reference is an ordinary server path that survives restarts and loads for every connected player.

The default location is `worlds/{world}/npc-randomizer`, where `{world}` expands to the current world id. Keeping art inside the world folder means it is captured by a world export/backup and travels with the world.

This matters for **Copy to Actor Sidebar**: when a rolled scene token is promoted to a permanent world actor, the generated image path and prompt are copied onto the new actor, so the permanent NPC keeps its art rather than reverting to the prototype's portrait.

### Settings

| Setting | Scope | Default | Purpose |
| --- | --- | --- | --- |
| OpenAI API Key | client | *(blank)* | Your key. Blank disables generation. |
| Generate Token Art on Drop | world | off | Generate when a randomized NPC is dropped. |
| Image Model | world | `gpt-image-1` | `gpt-image-1` or `dall-e-3`. |
| Image Size | world | `1024x1024` | Square suits tokens best. |
| Image Quality | world | `medium` | Higher costs more per image. |
| Art Direction | world | *(blank)* | Appended to every prompt; blank uses built-in token framing. |
| Image Storage Path | world | `worlds/{world}/npc-randomizer` | Upload target, relative to the data directory. |
| Apply Generated Art To | world | both | Map token, sheet portrait, or both. |

### Programmatic use

The module exposes an API on the module object, so art can be generated from a macro or script:

```js
const api = game.modules.get("dnd-npc-randomizer").api;

// Generate and apply in one step, honouring the configured settings.
await api.applyGeneratedImage({ actor: game.actors.getName("Gate Guard") });

// Or generate only, and handle the file yourself. Returns { path, prompt }.
const { path, prompt } = await api.generateImageForActor({
    actor: game.actors.getName("Gate Guard"),
    apiKey: "sk-...",          // optional: overrides the stored key
    race: "Tiefling",           // optional: overrides what the actor says
    description: "Scarred veteran with a brass eye",
    style: "grim oil painting, muted palette",
    size: "1024x1024"
});

// Inspect the prompt without spending anything.
api.buildPrompt({ race: "Dwarf", gender: "female", description: "Ash-streaked smith" });
```

> **Cost.** Every generation is a billed OpenAI image call. Generation is off by default and only ever runs for the GM.
