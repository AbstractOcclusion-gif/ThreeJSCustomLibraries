# Terrain texture library

These 1K JPEG maps are from Poly Haven under [CC0](https://polyhaven.com/license). Brown Mud includes color and height. The other sets also include OpenGL normal and roughness.

| Set | Source |
| --- | --- |
| `sparse_grass` | [Sparse Grass](https://polyhaven.com/a/sparse_grass) |
| `rock_wall_02` | [Rock Wall 02](https://polyhaven.com/a/rock_wall_02) |
| `snow_02` | [Snow 02](https://polyhaven.com/a/snow_02) |
| `mud_forest` | [Mud Forest](https://polyhaven.com/a/mud_forest) |
| `brown_mud` | [Brown Mud](https://polyhaven.com/a/brown_mud) |
| `grass_ground` | [Grass Ground](https://polyhaven.com/a/grass_ground) |
| `aerial_grass_rock` | [Aerial Grass Rock](https://polyhaven.com/a/aerial_grass_rock) |
| `aerial_rocks_02` | [Aerial Rocks 02](https://polyhaven.com/a/aerial_rocks_02) |
| `mossy_rock` | [Mossy Rock](https://polyhaven.com/a/mossy_rock) |
| `dry_ground_rocks` | [Dry Ground Rocks](https://polyhaven.com/a/dry_ground_rocks) |
| `gravelly_sand` | [Gravelly Sand](https://polyhaven.com/a/gravelly_sand) |
| `brown_mud_03` | [Brown Mud 03](https://polyhaven.com/a/brown_mud_03) |
| `forest_leaves_03` | [Forest Leaves 03](https://polyhaven.com/a/forest_leaves_03) |

The terrain bench packs height into the color map’s alpha channel and uses the rock normal as shared detail. Color is sRGB. Normal, height, and roughness are data maps.

Import `TERRAIN_TEXTURE_SETS`, `DEFAULT_TERRAIN_TEXTURES`, and
`getTerrainTextureMap(setId, role)` from `@abstractocclusion/three-kit/terrain/textures`.
Map paths are relative to this asset directory. Resolve them against the
URL where your app serves the bundled maps. The catalogue identifies map
roles, color spaces, normal conventions, and sources.

To add a set, add it to the catalogue in `src/terrain/textures.js` and run `npm run textures:fetch`: it downloads the maps a catalogue set is missing. `npm test` checks that every catalogue map is present and that all colour maps share one size.
