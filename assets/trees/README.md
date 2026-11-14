# Vegetation bench tree models

The original pine and spruce GLBs are Innerscene models released under CC0 1.0.

- [Mature Scots pine](https://www.innerscene.com/tools/library/3d-parts/mature-scots-pine-tree-280307e1)
- [Mature Norway spruce](https://www.innerscene.com/tools/library/3d-parts/mature-norway-spruce-tree-48c2566f)

The `ez-*.glb` models were authored and exported using Dan Greenheck's
[EZ-Tree editor](https://www.eztree.dev/) and carry its embedded bark and foliage textures.
See the [EZ-Tree source and license](https://github.com/dgreenheck/ez-tree).

The `ez-*-lod2.glb` files are the editor's LOD2 exports from the same settings.
The bench's **Distance test** switches each placement by camera distance and
renders distant specimens in static instanced batches. Both levels render
with complementary dither masks within 10% of the switch distance, and wind
eases out on the animated level across that band. The specimen count can be
raised to 48 per species, or 192 total with the stress button.

- **Oak** uses Oak Medium, seed 35729. The leader length is 27, the first branch length is 19, and first branches start at 0.31 with a 70° angle.
- **Spruce-like conifer** uses Pine Medium, seed 13977. First branches start at 0.13, with length 20, a 97° angle and 0.13 gnarliness. Needle cards start at 0.02, with count 46, size 4.2 and a 59° angle.
- **Birch** uses Aspen Medium, seed 18020. The main and secondary branch angles are 69° and 104°, with lengths of 10 and 6. First branches start at 0.38. The trunk radius is 0.9. Leaf cards have count 21 and size 2.1.
- **Bush** uses Bush 2, seed 45590. Six main stems spread at 53°, with five shoots each. Main and secondary branch lengths are 13 and 6, with secondary growth starting at 0.12. Leaf cards have count 19, size 3.4 and size variance 0.35.
