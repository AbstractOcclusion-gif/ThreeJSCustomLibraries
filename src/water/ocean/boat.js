// ocean/boat.js -- the test boat: Motorboat01 FBX + its PBR maps, a RigidBody sized from the mesh bounds, the Buoyancy probe
// lattice through the hull box (+2 probes: stern and hull centre for the controller's wetness), and the BoatController.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { RigidBody } from './rigid-body.js';
import { Buoyancy } from './buoyancy.js';
import { BoatController } from './boat-controller.js';
import { SphereInteractor } from './sphere-interactor.js';
import { Interactable } from './interactable.js';
import { SprayPump } from '../../particles/water/spray-pump.js';
import { OCEAN_CAUSTIC_GLSL } from './caustics.js';
import { SurfaceProbes } from './surface-sampler.js';

// Asset conventions (read off the file, see the batch notes): Z-up, Y-forward, centimetres, LOD0..3 + a UCX collision hull,
// two material slots (hull, outboard motor; the motor maps are the shared "BoatsCommon" set shipped with Motorboat02).
// exclusion: the UCX convex hull closes the cockpit (front pass: its gunwale "lid" starts the dry span), the lowest visible LOD
// bounds it tightly (back pass: a convex proxy bulges past the flank below the waterline and would swallow the water beside it).
const GROUND_STIFFNESS = 400, GROUND_DAMPING = 40, GROUND_FRICTION = 1.1, GROUND_FRICTION_OFF = 0.25, GROUND_MAX_PENETRATION = 0.4, GROUND_NORMAL_DX = 0.5;   // 1/s^2, 1/s, -, m, m
const gP = new THREE.Vector3(), gN = new THREE.Vector3(), gV = new THREE.Vector3(), gF = new THREE.Vector3(), gT = new THREE.Vector3();
const BOAT_ASSET = Object.freeze({ fbx: 'library/ocean/Boats/Motorboat01/SM_Motorboat01.FBX', lod0: 'SM_Motorboat01_LOD0', exclusionLid: 'UCX_SM_Motorboat01_LOD0', exclusionShell: 'SM_Motorboat01_LOD3', unitsPerMetre: 100,
  hullTex: 'library/ocean/Boats/Motorboat01/textures/T_MotorBoat01_01_', motorTex: 'library/ocean/Boats/Motorboat02/textures/T_Motorboat02_Engine_',
  // Helm (per boat, boat-group metres: +Z bow, +X port, origin on the keel line). Read off the LOD0 outboard material group:
  // its bracket spans z -2.5..-2.0 at the transom (hull min z -2.12), the tiller arm runs forward at x 0.10, y 0.74 to z -1.50.
  helm: { outboardMaterial: 1, steerPivot: [0, 0.5, -2.2], maxSteerDeg: 30, grip: [0.10, 0.745, -1.57], seat: [0.55, 1.38, -1.9] } });
const HULL_BOX_HEIGHT_FRACTION = 0.6;                    // the buoyant box is the lower part of the mesh bounds (deck + windscreen don't float)
const STERN_FRACTION = 0.45, STERN_DEPTH_FRACTION = 0.25; // Unity's sternOffset (0, -0.25, -2.2) on a ~5 m hull, as fractions of the hull
const WAKE_SPHERE_FRACTION = 0.3;                        // "MotorBoat Ready" prefab: interactor centreOffset z = 3 on its hull -> ahead of centre, toward the bow
const PROBE_STERN = 0, PROBE_HULL = 1, PROBE_SPRAY = 2;   // extra probes: stern, hull centre, then the spray row
// Spray probes: the "MotorBoat Ready" prefab's WaterSprayPump layout (Boat mode, Continuous, surface band ignored) mapped onto
// this hull as fractions of half-width (x) / half-length (z): two bow quarters (amount boost +1, outward forward-and-out), two
// midships and two aft flank probes (outward sideways). The prefab's muted stem probe (boost -1) is left out.
// y = prefab's 0.11 below the waterline (waterline ~ 40 % of the hull box).
const SPRAY_WATERLINE_FRACTION = 0.4, SPRAY_BELOW_WATERLINE = 0.11;
const SPRAY_LAYOUT = [{ x: 0.9, z: 0.84, out: [0.42, 0.9], boost: 1 }, { x: 1, z: 0.26, out: [1, 0.01], boost: 0 }, { x: 0.96, z: -0.33, out: [0.99, -0.13], boost: 0 }];
const Z_UP_TO_Y_UP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);   // authored +Z -> +Y, +Y -> -Z... bow lands on +Z (checked)

export class Boat {
  constructor({ocean, assetBaseUrl, emitSplash, groundHeightAt}) {
    this.group = new THREE.Group(); this.ready = false; this.body = null; this.length = 0;
    this.ocean = ocean; this.assetBaseUrl = assetBaseUrl; this.emitSplash = emitSplash; this.groundHeightAt = groundHeightAt;
    this.owned = new Set(); this.removeVolumes = [];
  }
  async load(renderer) {
    const url = path => new URL(path, this.assetBaseUrl).href;
    const fbx = await new FBXLoader().loadAsync(url(BOAT_ASSET.fbx));
    fbx.traverse(o => {
      if (!o.isMesh) return;
      this.owned.add(o.geometry);
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        this.owned.add(mat);
        for (const v of Object.values(mat)) if (v?.isTexture) this.owned.add(v);
      }
    });
    if (this.disposed) { this.releaseResources(); return this; }
    const texLoader = new THREE.TextureLoader(), aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const tex = (base, suffix, srgb) => {
      const t = texLoader.load(url(base + suffix + '.PNG'));
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = aniso; this.owned.add(t); return t;
    };
    const pbr = base => {
      const m = new THREE.MeshStandardMaterial({map: tex(base,'BC',true), normalMap: tex(base,'N'),
        roughnessMap: tex(base,'R'), metalnessMap: tex(base,'MT'), metalness: 1, roughness: 1});
      this.owned.add(m);
      const {caustics, exclusion} = this.ocean;
      if (caustics && exclusion) m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, caustics.uniforms, exclusion.uniforms);
        sh.vertexShader = 'varying vec3 vHullWorld;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vHullWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = ('varying vec3 vHullWorld; uniform sampler2D tExclusionFront; uniform float uExclusionOn; uniform vec2 uExclusionSize;\n' + sh.fragmentShader)
          .replace('#include <packing>', '#include <packing>\n' + OCEAN_CAUSTIC_GLSL)
          .replace('#include <lights_fragment_begin>', '#include <lights_fragment_begin>\n { float lid = uExclusionOn > .5 ? texture2D(tExclusionFront, gl_FragCoord.xy / uExclusionSize).r : 1.0; float k = lid < gl_FragCoord.z - 1e-4 ? 1.0 : causticLight(vHullWorld); reflectedLight.directDiffuse *= k; reflectedLight.directSpecular *= k; }');
      };
      return m;
    };
    const materials = [pbr(BOAT_ASSET.hullTex), pbr(BOAT_ASSET.motorTex)];
    let lod0 = null, lid = null, shell = null;
    fbx.traverse(o => { if (!o.isMesh) return; o.visible = o.name === BOAT_ASSET.lod0; if (o.name === BOAT_ASSET.exclusionLid) lid = o; if (o.name === BOAT_ASSET.exclusionShell) shell = o;
      if (o.visible) { lod0 = o; o.castShadow = true; o.material = Array.isArray(o.material) ? o.material.map((_, i) => materials[Math.min(i, materials.length - 1)]) : materials[0]; } });
    if (!lod0) throw new Error(`boat: mesh ${BOAT_ASSET.lod0} not found in ${BOAT_ASSET.fbx}`);
    if (!lid || !shell) throw new Error(`boat: exclusion meshes ${BOAT_ASSET.exclusionLid} / ${BOAT_ASSET.exclusionShell} not found in ${BOAT_ASSET.fbx}`);
    this.exclusionLid = lid; this.exclusionShell = shell;   // dry-interior exclusion volumes (invisible, follow the boat)
    fbx.scale.setScalar(1 / BOAT_ASSET.unitsPerMetre); fbx.quaternion.copy(Z_UP_TO_Y_UP); fbx.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(lod0), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    fbx.position.sub(center).y += size.y * 0.5;   // origin at the keel line, hull centred
    this.group.add(fbx); this.length = size.z; this.width = size.x;
    this.keelPoints = [];   // grounding contacts: a 3 x 5 grid under the hull, inset from the hull outline, raised at the flared ends
    for (const fz of [-0.45, -0.22, 0, 0.22, 0.42]) for (const fx of [-0.3, 0, 0.3]) this.keelPoints.push(new THREE.Vector3(fx * size.x * (1 - Math.abs(fz)), Math.abs(fz) > 0.4 ? 0.15 : 0.02, fz * size.z));
    this.splitOutboard(lod0, materials[BOAT_ASSET.helm.outboardMaterial]);
    const hullSize = new THREE.Vector3(size.x, size.y * HULL_BOX_HEIGHT_FRACTION, size.z), hullCenter = new THREE.Vector3(0, hullSize.y * 0.5, 0);
    this.body = new RigidBody({ mass: 1, boxSize: hullSize, centerOfMassLocal: hullCenter });
    const sprayY = Math.max(0, hullSize.y * SPRAY_WATERLINE_FRACTION - SPRAY_BELOW_WATERLINE);
    this.sprayProbes = [];
    for (const q of SPRAY_LAYOUT) for (const side of [-1, 1])
      this.sprayProbes.push({ local: new THREE.Vector3(side * hullSize.x * 0.5 * q.x, sprayY, size.z * 0.5 * q.z), outwardLocal: new THREE.Vector3(side * q.out[0], 0, q.out[1]).normalize(), ignoreSurfaceBand: true, amountBoost: q.boost });
    this.buoyancy = new Buoyancy(this.body, hullCenter, hullSize, {}, PROBE_SPRAY + this.sprayProbes.length, count => new SurfaceProbes(this.ocean.fft, count, {wake: this.ocean.wake}));
    this.spray = new SprayPump(this.body, this.sprayProbes, {}, this.emitSplash);
    const stern = new THREE.Vector3(0, hullSize.y * (0.5 - STERN_DEPTH_FRACTION), -size.z * STERN_FRACTION);
    this.controller = new BoatController(this.body, stern);
    // wake: the demo prefab's single small interactor sphere forward of the hull centre (WaterSphereInteractor)
    this.interactor = new SphereInteractor(this.group, new THREE.Vector3(0, hullCenter.y, size.z * WAKE_SPHERE_FRACTION), hullSize.clone().multiplyScalar(0.5));
    // wake ridge: WaterInteractable drops from the whole renderer bounds (origin sits on the keel line, so bounds min y = 0)
    this.interactable = new Interactable(this.group, new THREE.Vector3(0, size.y * 0.5, 0), size.clone().multiplyScalar(0.5), 0);
    const exclusion = this.ocean.exclusion;
    if (exclusion) this.removeVolumes.push(exclusion.add(lid.geometry, lid, {back: false}),
      exclusion.add(shell.geometry, shell, {front: false}));
    this.ready = true;
    console.info(`boat loaded: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)} m, ${this.buoyancy.localPoints.length} probes, sphere r ${this.buoyancy.sphereRadius.toFixed(2)} m`);
    return this;
  }
  // The outboard is one material group of the hull mesh: move its triangles into their own mesh pivoting on the transom
  // bracket so it can swing with the steering (the tiller sweeps opposite to the turn, as on a real tiller outboard).
  splitOutboard(hullMesh, material) {
    const helm = BOAT_ASSET.helm, geometry = hullMesh.geometry;
    const group = geometry.groups.find(g => g.materialIndex === helm.outboardMaterial);
    if (!group) throw new Error(`boat: outboard material group ${helm.outboardMaterial} not found on ${hullMesh.name}`);
    if (geometry.index) throw new Error('boat: indexed hull geometry not supported by splitOutboard');
    this.group.updateMatrixWorld(true);
    const toBoat = this.group.matrixWorld.clone().invert().multiply(hullMesh.matrixWorld), normalToBoat = new THREE.Matrix3().getNormalMatrix(toBoat);
    const pivot = new THREE.Vector3().fromArray(helm.steerPivot), part = new THREE.BufferGeometry(), v = new THREE.Vector3();
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      const size = attribute.itemSize, data = attribute.array.slice(group.start * size, (group.start + group.count) * size);
      const out = new THREE.BufferAttribute(data, size);
      if (name === 'position') for (let i = 0; i < out.count; i++) v.fromBufferAttribute(out, i).applyMatrix4(toBoat).sub(pivot).toArray(data, i * 3);
      else if (name === 'normal') for (let i = 0; i < out.count; i++) v.fromBufferAttribute(out, i).applyMatrix3(normalToBoat).normalize().toArray(data, i * 3);
      part.setAttribute(name, out);
    }
    geometry.groups = geometry.groups.filter(g => g !== group);   // the hull no longer draws the outboard triangles
    this.owned.add(part); this.outboard = new THREE.Mesh(part, material); this.outboard.name = 'Outboard (steers)'; this.outboard.castShadow = true;
    this.outboard.position.copy(pivot); this.group.add(this.outboard);
    // helm anchors in boat space; the grip rides the tiller
    this.helmSeat = new THREE.Vector3().fromArray(helm.seat);
    this.tillerGrip = new THREE.Group(); this.tillerGrip.name = 'Tiller grip anchor';
    this.tillerGrip.position.fromArray(helm.grip).sub(pivot); this.outboard.add(this.tillerGrip);
    this.maxSteer = helm.maxSteerDeg * Math.PI / 180;
  }
  // Frame start: pick up the finished readback.
  collectSamples() { if (this.ready) this.buoyancy.probes.collect(); }
  // Fixed physics step (after the readback): forces, drive, integrate, place the mesh.
  step(dt) {
    if (!this.ready) return;
    this.controller.readInput();
    this.buoyancy.step();
    this.controller.step(dt, this.buoyancy.extraSample(PROBE_STERN), this.buoyancy.extraSample(PROBE_HULL));
    this.groundContact(dt);
    this.body.integrate(dt); this.body.applyTo(this.group);
    this.outboard.rotation.y = this.controller.steer * this.maxSteer;   // steer > 0 (turn right) swings the tiller to port (+X)
  }
  // Grounding (Oct 2026): keel points against the island / sea floor height (groundHeightAt, set by main.js): a stiff damped
  // spring along the ground normal plus Coulomb friction, applied as ForceMode.Acceleration at each touching point, so the hull
  // stops, scrapes and can sit beached; a deep penetration (teleport, big wave) is lifted out at once.
  groundContact(dt) {
    if (!this.groundHeightAt || !this.keelPoints) return;
    const b = this.body; let touching = 0;
    for (const local of this.keelPoints) {
      const p = b.localToWorldPoint(local, gP), h = this.groundHeightAt(p.x, p.z); if (h === undefined) continue;
      const pen = h - p.y; if (pen <= 0) continue; touching++;
      gN.set((this.groundHeightAt(p.x - GROUND_NORMAL_DX, p.z) ?? h) - (this.groundHeightAt(p.x + GROUND_NORMAL_DX, p.z) ?? h), 2 * GROUND_NORMAL_DX,
        (this.groundHeightAt(p.x, p.z - GROUND_NORMAL_DX) ?? h) - (this.groundHeightAt(p.x, p.z + GROUND_NORMAL_DX) ?? h)).normalize();
      const v = b.getPointVelocity(p, gV), vn = v.dot(gN), push = Math.max(0, GROUND_STIFFNESS * pen - GROUND_DAMPING * vn) / this.keelPoints.length;
      gF.copy(gN).multiplyScalar(push);
      gT.copy(v).addScaledVector(gN, -vn); const vt = gT.length();
      // sand grips a hull driven up the slope; sliding back down towards deeper water (reversing off) grips much less
      const mu = gT.x * gN.x + gT.z * gN.z > 0 ? GROUND_FRICTION_OFF : GROUND_FRICTION;   // the normal's horizontal part points downhill
      if (vt > 1e-4) gF.addScaledVector(gT, -Math.min(mu * push, vt / dt / this.keelPoints.length) / vt);
      b.addForceAtPosition(gF, p);
      if (pen > GROUND_MAX_PENETRATION) b.position.addScaledVector(gN, pen - GROUND_MAX_PENETRATION);
    }
    this.grounded = touching > 0;
  }
  // After the FFT update: refresh the probe points and queue this frame's sample.
  issueSamples(waveTime, cameraPosition) {
    if (!this.ready) return;
    this.buoyancy.updateProbePoints();
    this.controller.sternWorld(this.buoyancy.extraProbe(PROBE_STERN));
    this.buoyancy.extraProbe(PROBE_HULL).copy(this.body.worldCenterOfMass);
    for (let i = 0; i < this.sprayProbes.length; i++) this.body.localToWorldPoint(this.sprayProbes[i].local, this.buoyancy.extraProbe(PROBE_SPRAY + i));
    this.buoyancy.probes.issue(waveTime, cameraPosition);
  }
  // Water height under the hull centre this frame (undefined until the first readback).
  get waterlineY() { const hull = this.ready ? this.buoyancy.extraSample(PROBE_HULL) : null; return hull && hull.valid ? hull.height : undefined; }
  // After the physics step: lay this frame's wake into the sim window. mode: 'drops' (WaterInteractable MouseLikeDrops) or
  // 'footprint' (FootprintDelta: the obstacle maps carry the hull, see obstacle.js); the sphere dipole runs in both.
  updateWake(window, dt, mode) {
    if (!this.ready) return;
    const waterline = this.waterlineY;
    if (mode === 'drops') this.interactable.update(window, waterline); else this.interactable.tracking = false;
    this.interactor.update(window, dt, waterline);
  }
  // After the physics step: the spray pump on the hull probes.
  // Yaw rate in Unity's sense (deg/s, > 0 = turning right): three's +Y spin is counter-clockwise seen from above.
  updateSpray(dt) {
    if (!this.ready) return;
    this.spray.step(dt, i => this.buoyancy.extraSample(PROBE_SPRAY + i), (i, out) => this.body.localToWorldPoint(this.sprayProbes[i].local, out), -this.body.angularVelocity.y * 180 / Math.PI);
  }
  get speed() { return this.ready ? this.body.velocity.length() : 0; }
  releaseResources() { for (const resource of this.owned) resource.dispose(); this.owned.clear(); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.ready = false;
    this.buoyancy?.dispose(); this.controller?.dispose();
    for (const remove of this.removeVolumes.splice(0)) remove();
    this.group.removeFromParent();
    this.releaseResources();
  }
}
