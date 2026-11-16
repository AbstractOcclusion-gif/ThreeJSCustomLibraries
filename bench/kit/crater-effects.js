// What a crater throws out, for the pages that wire the terrain's 'terrain:crater' event to the particles tool (the
// Crater demo, the Drive demo): shards by the strata it cut, and dust over it. One copy of the recipe.
import * as THREE from 'three';
import {TERRAIN_ROLE_TINTS} from '../../src/terrain/index.js';

// What each stratum's debris looks like: the terrain's own role tints (topsoil is the dark top earth).
export const STRATA_TINT = {topsoil: TERRAIN_ROLE_TINTS.mud, subsoil: TERRAIN_ROLE_TINTS.soil, scree: TERRAIN_ROLE_TINTS.scree, rock: TERRAIN_ROLE_TINTS.rock};
// Shards (particle chips): count from the thrown volume (m³ x perCubicMetre, at most max a crater), thrown outward
// from `bursts` points on the rim at `speed` x sqrt(g x reach) m/s, so they clear the crater; shock (pop strength)
// from the crater depth.
export const CRATER_SHARDS = {pool: 900, perCubicMetre: 18, max: 240, bursts: 8, speed: 1.1, shockPerMetre: 14, maxShock: 70, size: 1.4};
// Dust (particle puffs): one cloud over the crater, `perMetre` of its reach in size (at most maxSize), and `ring`
// smaller ones (`ringShare` of that size) around the rim.
export const CRATER_DUST = {pool: 120, perMetre: .9, maxSize: 7, ring: 6, ringShare: .55};
const GRAVITY = 9.82;

// chips, puffs: the particles tool's. heightAt(x, z): the ground (undefined off it).
// Returns the two effects and what they are aimed with, for a page that throws more from a crater (clods):
// {throwShards(event, y), throwDust(event, y), aroundCrater(event, k, n, share, y), escapeSpeed(event), origin, rimPoint, outward}.
export function createCraterEffects({chips, puffs, heightAt}) {
  const SHARDS = CRATER_SHARDS, DUST = CRATER_DUST;
  const origin = new THREE.Vector3();
  const rimPoint = new THREE.Vector3(), outward = new THREE.Vector3();
  // Point k of n around the crater, `share` of its reach from the centre, on the ground; `outward` points away.
  function aroundCrater(event, k, n, share, y) {
    const angle = (k + Math.random()) / n * Math.PI * 2;
    outward.set(Math.cos(angle), 0, Math.sin(angle));
    rimPoint.set(event.x + outward.x * event.reach * share, 0, event.z + outward.z * event.reach * share);
    rimPoint.y = heightAt(rimPoint.x, rimPoint.z) ?? y;
    return rimPoint;
  }
  const escapeSpeed = event => Math.sqrt(GRAVITY * event.reach);   // m/s that throws debris about a crater width
  function throwShards(event, y) {
    const shock = Math.min(SHARDS.maxShock, event.depth * SHARDS.shockPerMetre), total = Math.min(SHARDS.max, event.ejecta * SHARDS.perCubicMetre);
    for (const [name, share] of Object.entries(event.strata)) {
      const count = Math.round(total * share / SHARDS.bursts);
      if (count <= 0) continue;
      const style = {color: new THREE.Color(STRATA_TINT[name]).getHex(), chips: count, size: SHARDS.size};
      for (let k = 0; k < SHARDS.bursts; k++) {
        aroundCrater(event, k, SHARDS.bursts, 1, y);
        chips.emit(rimPoint, style, shock, outward.multiplyScalar(SHARDS.speed * escapeSpeed(event)));
      }
    }
  }
  function throwDust(event, y) {
    const size = Math.min(DUST.maxSize, event.reach * DUST.perMetre);
    puffs.dust(origin.set(event.x, y, event.z), size);
    for (let k = 0; k < DUST.ring; k++) puffs.dust(aroundCrater(event, k, DUST.ring, 1.1, y), size * DUST.ringShare);
  }
  return {throwShards, throwDust, aroundCrater, escapeSpeed, origin, rimPoint, outward};
}
