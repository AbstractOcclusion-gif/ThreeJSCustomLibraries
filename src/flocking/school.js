import * as THREE from 'three';

// WebAquarium fish/brain.js schooling stage. The enclosing flock supplies its
// local state and force priorities, independent of aquarium gameplay.
const DODGE_T = .4, DODGE_MARGIN = 1.35, DODGE_VERT = .35, DODGE_ACC = 6;
const DODGE_START = .3, DODGE_TIME = .35;
const HARD_PUSH_SPEED = .25, HARD_VERT = .3, HARD_FOLLOW = .6;
const SEP_VERT = .35, SCHOOL_VERT = .5;
const dampTau = (tau, dt) => 1 - Math.exp(-dt / tau);

export function createSchoolStage({P, fish, SPECIES, fishLength, FT, ARB, NEAR, PRED, gatherNear, lvl, nk, random}) {
 const DG = new THREE.Vector3(), HP = new THREE.Vector3();
return function fishSchool(FC, FRAME) {
  const { f, i, sp, L, cruise, acc, dt, relist, L0, R, sw } = FC;
  let n = 0;
  ARB.on = P.arbitrate && P.smartSteer; if (ARB.on) for (let l = 0; l < 6; l++) FT.lv[l].set(0, 0, 0);
  FT.al.set(0, 0, 0); FT.co.set(0, 0, 0); FT.se.set(0, 0, 0); let ns = 0, n2 = 0;
  const dsy = P.schoolDesync && P.smartSteer; if (f.rlat === undefined) { f.rlat = 0.6 + random() * 0.8; f.rk = 0.8 + random() * 0.45; f.tk = 0.88 + random() * 0.24; }   // per-fish reaction latency / reactivity / agility, drawn once
  const ors = P.orientSpace && P.smartSteer && !(f.lure > 0), sr = Math.min(1.5, f.spd / Math.max(cruise, 1e-4));
  // Verlet neighbour list: full grid scan every 3rd frame (staggered; every frame while fleeing / striking) at reach + skin, then only the list
  const nb0 = f.nb, nb = f.nb ||= [];
  if (relist || !nb0 || (FRAME + i) % 3 === 0 || f.fear > 0 || f.strike > 0 || f.dart > 0) { nb.length = 0;
    for (let q = 0, nn = gatherNear(f.p.x, f.p.z, sp._ring); q < nn; q++) { const j = NEAR[q]; if (i === j) continue; const o = fish[j];
      const ex = o.p.x - f.p.x, ey = o.p.y - f.p.y, ez = o.p.z - f.p.z; if (ex * ex + ey * ey + ez * ez < sp._list2) nb.push(j); } }
  for (let q = 0; q < nb.length; q++) { const j = nb[q]; const o = fish[j]; if (!o) continue;
    const ex = o.p.x - f.p.x, ey = o.p.y - f.p.y, ez = o.p.z - f.p.z, d2 = ex * ex + ey * ey + ez * ez; if (d2 > sp._reach2 || d2 < 1e-10) continue;   // squared-distance reject first
    FT.d.set(ex, ey, ez); const dd = Math.sqrt(d2);
    const so = SPECIES[o.sp], aw = o.sp !== f.sp && f.lure > 0 ? 0 : sp._aff[o.sp];   // flock weight (investigating the lure: own species only)
    if (aw > 0 && dd <= R) { n += aw; FT.al.addScaledVector(o.v, aw); FT.co.addScaledVector(o.p, aw); if (o.sp === f.sp) ns += o.side || 0; if (dd < L * 2) n2 += aw; }   // own species, plus partners by affinity
    // personal space (FishSystem ComputeHeroSeparation: linear falloff) sized from BOTH fish lengths
    const half = (L + fishLength(o)) * 0.5, mixW = o.sp === f.sp ? 1 : Math.min(1, aw); let space = half * (sp.schoolSpace * mixW + (sp.space + so.space) * 0.5 * (1 - mixW));   // flock partners keep school spacing
    // oriented personal space: longer in front (grows with speed), shorter behind (a wider turn-side zone was tested: more reversals, no gain)
    const cb = ors ? (FT.d.x * f.dir.x + FT.d.y * f.dir.y + FT.d.z * f.dir.z) / dd : 0;
    if (ors) { space *= cb > 0 ? 1 + (sp.fwd - 1) * cb * (0.5 + 0.5 * sr) : 1 + 0.4 * cb; }
    if (dd < space) { const w = (1 - dd / space) / dd;
      if (ors && cb > 0.2) {                                   // fish ahead: steer round it instead of braking -- 70 % of the backward part goes lateral
        FT.al2.copy(FT.d).addScaledVector(f.dir, -cb * dd); let ll = FT.al2.length();
        if (ll < 1e-4) { FT.al2.set(f.dir.z, 0, -f.dir.x).multiplyScalar(f.hand || 1); ll = FT.al2.length() || 1; }
        FT.se.addScaledVector(FT.al2, -w * dd / ll * (Math.sqrt(Math.max(0, 1 - cb * cb)) + 0.7 * cb)).addScaledVector(f.dir, -w * dd * cb * 0.3); }
      else FT.se.addScaledVector(FT.d, -w); }
    const hard = half * (0.45 * mixW + 0.7 * (1 - mixW));                    // schools may touch flank to flank; other species keep a clear gap
    if (dd < hard && !o.jump) {                                              // bodies never pass through each other (each fish of the pair takes half)
      HP.copy(FT.d).multiplyScalar(-(hard - dd) / dd * 0.5); HP.y *= HARD_VERT;
      const closing = Math.max(0, -(FT.d.x * (o.v.x - f.v.x) + FT.d.y * (o.v.y - f.v.y) + FT.d.z * (o.v.z - f.v.z)) / dd), cap = (HARD_PUSH_SPEED + closing) * dt, hl = HP.length();
      if (hl > cap) HP.multiplyScalar(cap / hl);
      f.p.add(HP); lvl(0, acc).addScaledVector(HP, HARD_FOLLOW / Math.max(dt, 1e-4)); }
    // dodge: closest approach of the pair within DODGE_T (relative motion); a predicted pass inside the hard gap steers this fish aside now
    if (!o.jump && !f.jump) { DG.subVectors(o.v, f.v); const w2 = DG.lengthSq(), tc = w2 > 1e-8 ? THREE.MathUtils.clamp(-FT.d.dot(DG) / w2, 0, DODGE_T) : 0;
      if (tc > 0) { DG.multiplyScalar(tc).add(FT.d); const miss = DG.length(), lim = hard * DODGE_MARGIN;          // DG = where the other fish will be, relative
        if (miss < lim) { const u = (1 - miss / lim) * (1 - 0.5 * tc / DODGE_T);
          if (miss < 1e-4) DG.set(-f.dir.z, 0, f.dir.x).multiplyScalar(-(f.hand || 1)); else DG.y *= DODGE_VERT;   // head-on: pick the fish's own side
          const dl = DG.length(); if (dl > 1e-6) { lvl(1, acc).addScaledVector(DG, -u * DODGE_ACC * cruise / dl); if (u > DODGE_START) f.dodge = DODGE_TIME; } } } }
  }
  if (!sp.pred) for (let q = 0; q < PRED.length; q++) { const o = fish[PRED[q]]; if (o.jump) continue;   // keep clear of the pike -- oriented: a big zone in its frontal cone, small behind it
    const ex = o.p.x - f.p.x, ey = o.p.y - f.p.y, ez = o.p.z - f.p.z, d2 = ex * ex + ey * ey + ez * ez; if (d2 > 0.75 || d2 < 1e-10) continue;
    const dd = Math.sqrt(d2), so = SPECIES[o.sp], pc = ors ? -(ex * o.dir.x + ey * o.dir.y + ez * o.dir.z) / dd : 0, pr = 0.5 * (pc > 0 ? 1 + (so.fwd - 1) * 0.6 * pc : 1 + 0.4 * pc);
    if (dd < pr) lvl(1, acc).add(FT.d.set(ex, ey, ez).multiplyScalar(-(1 - dd / pr) * 2.5 / dd)); }
  f.nside = ns;
  const trt = P.speciesTraits && P.smartSteer, swc = sw * (trt ? 1 - 0.5 * sp.cover : 1) * nk(sp, 'school');   // perch: loose groups; v121: loose shoals at night
  if (n) { FT.al.divideScalar(n).sub(f.v).multiplyScalar(1.2 * P.fishSchool * sp.school * swc);
    // cohesion eases off once the fish already has company (> 2 schoolmates within 2 body lengths): no clumping into a ball
    FT.co.divideScalar(n).sub(f.p).multiplyScalar(0.8 * P.fishSchool * sp.school * swc * (dsy ? THREE.MathUtils.clamp(1 - (n2 - sp.dens) / 3, 0.25, 1) : 1)); FT.al.add(FT.co); }
  else FT.al.set(0, 0, 0);
  FT.al.y *= SCHOOL_VERT; FT.se.y *= SEP_VERT;                               // social forces mostly horizontal (see SEP_VERT)
  // reaction latency: each fish sees its schoolmates through its own lag (species base x 0.6-1.4), so a school turns as a ripple, not in one frame
  if (dsy) { (f.scL ||= new THREE.Vector3()).lerp(FT.al, dampTau(Math.max(1e-3, sp.react * f.rlat), dt)); lvl(5, acc).add(f.scL); } else if (n) lvl(5, acc).add(FT.al);
  lvl(2, acc).addScaledVector(FT.se, 2.5 * cruise * P.fishSeparation * sp.separation);
}
}
