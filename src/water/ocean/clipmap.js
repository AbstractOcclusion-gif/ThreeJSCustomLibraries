// ocean/clipmap.js -- port of WebGpuWater's LargeWaterClipmap.cs (annulus template) + WaterVolume.OceanClipmap.cs (level placement).
//
// Losasso/Hoppe geometry clipmap: the ocean is N nested square LOD levels. One shared uniform square-annulus grid is authored
// in INTEGER CELL UNITS; level L scales it by finestCell * 2^L and places it at the camera SNAPPED to that level's own world
// lattice (multiples of 2 cells), so the wave field (a pure function of world xz) is sampled at stable world points however
// the camera moves -- no "geometry swim". The surface shader morphs each level's outer band onto the next-coarser lattice
// (nearest EVEN cell) so levels meet crack-free.
//
// Divergence from Unity: there is no near-field sim patch yet, so the INNERMOST level is a full grid (hole 0) built by the
// same template builder, and the finest cell size is authored directly instead of being derived from the patch extent.
import * as THREE from 'three';

// Mirrors WaterVolume.Settings.Ocean.cs clipmap constants.
const MIN_GRID_RESOLUTION = 8;                           // LargeWaterClipmap.MinGridResolution
const MIN_LEVELS = 2, MAX_LEVELS = 12;                   // ClipmapMinLevels / ClipmapMaxLevels
const SNAP_CELL_MULTIPLE = 2;                            // each level snaps to 2*cell so its even cells align with the coarser level
const HOLE_MARGIN_CELLS = 2;                             // shrink each level's hole so it overlaps the finer level (no seam gap)
const MORPH_BAND_FRACTION = 0.5;                         // fraction of the annulus half-width used for the edge geomorph
// Finer levels get a larger toward-camera depth nudge so they win where they overlap a coarser one (Unity: per-level depthBias).
// Expressed in polygon-offset units (smallest resolvable depth steps) per level of fineness.
const DEPTH_BIAS_UNITS_PER_LEVEL = -2;

export const CLIPMAP_DEFAULTS = Object.freeze({ gridResolution: 64, finestCellMeters: 0.5, outerRadiusMeters: 10000 });

// Uniform square-annulus grid in cell units: vertices (i, 0, j), i,j in [-M/2, M/2]; quads wholly inside the central
// hole square (|span| <= holeHalfCells) are left untriangulated. holeHalfCells = 0 -> full grid.
export function buildAnnulusTemplate(gridResolution, holeHalfCells) {
  validateOrThrow(gridResolution, holeHalfCells);
  const half = gridResolution / 2, stride = gridResolution + 1;
  const positions = new Float32Array(stride * stride * 3), uvs = new Float32Array(stride * stride * 2);
  const vertexIndex = (i, j) => (i + half) * stride + (j + half);
  for (let i = -half; i <= half; i++) for (let j = -half; j <= half; j++) {
    const v = vertexIndex(i, j);
    positions[v * 3] = i; positions[v * 3 + 1] = 0; positions[v * 3 + 2] = j;
    uvs[v * 2] = (i + half) / gridResolution; uvs[v * 2 + 1] = (j + half) / gridResolution;
  }
  const indices = [];
  for (let i = -half; i < half; i++) for (let j = -half; j < half; j++) {
    const insideX = i >= -holeHalfCells && i + 1 <= holeHalfCells, insideZ = j >= -holeHalfCells && j + 1 <= holeHalfCells;
    if (insideX && insideZ) continue;
    const a = vertexIndex(i, j), b = vertexIndex(i + 1, j), c = vertexIndex(i, j + 1), d = vertexIndex(i + 1, j + 1);
    indices.push(a, c, b, b, c, d);                        // wound so the surface faces +Y
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);                              // three picks Uint32 when the count needs it
  return geometry;
}

function validateOrThrow(gridResolution, holeHalfCells) {
  if (!(gridResolution >= MIN_GRID_RESOLUTION)) throw new RangeError(`clipmap gridResolution ${gridResolution}: needs >= ${MIN_GRID_RESOLUTION} cells per side`);
  if (gridResolution & 1) throw new RangeError(`clipmap gridResolution must be even (got ${gridResolution})`);
  if (holeHalfCells < 0 || holeHalfCells >= gridResolution / 2) throw new RangeError(`clipmap holeHalfCells ${holeHalfCells}: must be in [0, ${gridResolution / 2})`);
}

// Level count so the outermost level's half-extent (M/2 * cell * 2^L) reaches the horizon radius, clamped like Unity.
export function resolveLevelCount(gridResolution, finestCellMeters, outerRadiusMeters) {
  const finestHalfExtent = (gridResolution / 2) * finestCellMeters;
  const levels = Math.ceil(Math.log2(Math.max(outerRadiusMeters, finestHalfExtent) / finestHalfExtent)) + 1;
  return THREE.MathUtils.clamp(levels, MIN_LEVELS, MAX_LEVELS);
}

export class OceanClipmap {
  // material: the shared ocean surface ShaderMaterial; it must expose uMorphStart / uMorphScale uniforms.
  constructor(scene, material, settings = {}) {
    const s = { ...CLIPMAP_DEFAULTS, ...settings };
    const m = Math.max(MIN_GRID_RESOLUTION, s.gridResolution); this.gridResolution = m + (m & 1);   // forced even (symmetric hole)
    this.finestCellMeters = s.finestCellMeters; this.outerRadiusMeters = s.outerRadiusMeters;
    this.scene = scene; this.material = material;
    this.holeHalfCells = Math.max(1, this.gridResolution / 4 - HOLE_MARGIN_CELLS);
    this.levelCount = resolveLevelCount(this.gridResolution, this.finestCellMeters, this.outerRadiusMeters);
    this.annulus = buildAnnulusTemplate(this.gridResolution, this.holeHalfCells);
    this.fullGrid = buildAnnulusTemplate(this.gridResolution, 0);   // innermost level: no finer level / patch fills its hole
    const morphBandCells = Math.max(1, Math.round((this.gridResolution / 4) * MORPH_BAND_FRACTION));
    this.levels = [];
    for (let level = 0; level < this.levelCount; level++) {
      const outermost = level === this.levelCount - 1;
      const entry = {
        cellSize: this.finestCellMeters * 2 ** level,
        // Outermost level has no coarser neighbour: disable its edge morph by pushing the start past the outer edge.
        morphStart: outermost ? this.gridResolution : this.gridResolution / 2 - morphBandCells,
        morphScale: 1 / morphBandCells,
        mesh: new THREE.Mesh(level === 0 ? this.fullGrid : this.annulus, material),
      };
      entry.mesh.frustumCulled = false;                    // recentred on the camera every frame: never cull
      entry.mesh.scale.set(entry.cellSize, 1, entry.cellSize);   // template verts are in cell units
      // One shared material for every level: three only re-uploads a ShaderMaterial's uniforms between draws of the SAME
      // material when uniformsNeedUpdate is set, so the per-level morph floats are stamped here right before each draw.
      // Polygon offset is (re)applied by three's state cache per draw too, so the per-level depth bias rides the same hook.
      entry.depthBiasUnits = DEPTH_BIAS_UNITS_PER_LEVEL * (this.levelCount - 1 - level);
      entry.mesh.onBeforeRender = () => {
        material.uniforms.uMorphStart.value = entry.morphStart; material.uniforms.uMorphScale.value = entry.morphScale;
        material.uniformsNeedUpdate = true;
        material.polygonOffset = true; material.polygonOffsetFactor = 0; material.polygonOffsetUnits = entry.depthBiasUnits; };
      entry.mesh.renderOrder = this.levelCount - level;    // finer levels draw first where they overlap a coarser one
      this.levels.push(entry); scene.add(entry.mesh);
    }
  }
  // Re-place every level: snap its centre to its own world lattice (multiples of 2*cell) around the follow point.
  update(followPosition) {
    for (const level of this.levels) {
      const snap = SNAP_CELL_MULTIPLE * level.cellSize;
      level.mesh.position.set(Math.round(followPosition.x / snap) * snap, 0, Math.round(followPosition.z / snap) * snap);
    }
  }
  get triangleCount() { return this.levels.reduce((n, l) => n + l.mesh.geometry.index.count / 3, 0); }
  dispose() {
    for (const level of this.levels) this.scene.remove(level.mesh);
    this.annulus.dispose(); this.fullGrid.dispose(); this.levels.length = 0;
  }
}
