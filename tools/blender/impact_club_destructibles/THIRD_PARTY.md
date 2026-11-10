# Cell Fracture

The files `vendor/cell_fracture/fracture_cell_calc.py` and
`vendor/cell_fracture/fracture_cell_setup.py` are based on Blender's
[Cell Fracture extension](https://extensions.blender.org/add-ons/cell-fracture/).

Source repository: https://projects.blender.org/extensions/object_fracture_cell

Pinned commit: `4500a267f868bc99c35207930c9d2ee6e8f314c6` (extension version 0.2.1).

Local change in `fracture_cell_setup.py`: add `use_hull_noise`, defaulting to the
upstream behavior. The structure authoring script disables the legacy random
perturbation of computed Voronoi vertices through the wrapper's explicit
`preserve_cell_planes=True` option. In Blender 5.0 that perturbation made thin,
flat-source fragments non-convex and forced enclosing-box colliders. General
authoring keeps its existing defaults; the separate `source_noise` option and all
hull validation/fallback behavior remain intact.
The structure authoring regression checks 44 thin panel fragments without any
box fallback; the original Blender authoring smoke checks still run separately.

The source-file copyright/SPDX headers are preserved. The extension manifest
declares GPL-3.0-or-later; the individual implementation files retain their
GPL-2.0-or-later headers. This combined addon is distributed under GPL-3.0-or-later;
the full license is included in LICENSE.txt.

The custom wrapper calls the existing point-cell construction and Boolean
intersection functions. It does not register or replace the original Cell
Fracture operator, and requires no separately installed Cell Fracture extension.

GLB export uses Blender's installed glTF 2.0 exporter, which is not copied into
this package. No Synty or other paid model/texture assets are included in the addon.
