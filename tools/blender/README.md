# Blender authoring tools

This directory contains the Impact Club Destruction Author extension from
Glider 2. The extension authors
pre-fractured props and structural parts, exporting paired `.glb` and
`.destructible.json` files for the destruction runtime.

Run `node tools/blender/package_structure_addon.mjs` with Blender 5.0 installed.
Set `BLENDER_EXE` to the executable path if it differs from the script's default.
The script stages the shared structure material profiles and atlas, then builds
and validates the extension ZIP under `tools/blender/.build/`. Install that ZIP
from Blender's **Preferences → Get Extensions → Install from Disk**.

The extension source, GPL-3.0-or-later license and Cell Fracture notices are in
[`impact_club_destructibles/`](impact_club_destructibles/README.md). Author and export
parts in Blender, put paired exports under `assets/structures/`, then run
`npm run build:catalogue` to update the runtime manifest.

The extension is distributed separately from Three Kit's npm package.
