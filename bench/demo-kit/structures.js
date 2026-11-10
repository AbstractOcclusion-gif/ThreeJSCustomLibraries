// Built things shared by the mixed demos: a fence and a hedge round the camp (boundaries), a rope slung between two posts
// (cable, on cannon-es) and a truss bridge to shoot down (destruction). The hedge and the rope read
// the shared environment; the bridge reuses the Destruction demo's physics client.
import * as THREE from 'three';
import * as C from 'cannon-es';
import {createCable, createThreeCableView} from '../../src/cable/index.js';
import {createBoundaries, makeRun} from '../../src/boundaries/index.js';
import {createThreeStructureView} from '../../src/destruction/three.js';
import {createDemolition} from '../destruction/physics.js';

const STEP = 1 / 120, MAX_STEPS_PER_FRAME = 6;   // fixed physics step; a slow frame never replays more than this
// Metres, relative to the camp.
const RUNS = Object.freeze([['fence', [[-8, -6], [1, -8.5], [10, -6]]], ['hedge', [[-11, 3], [-11, -4]]]]);
const ROPE = Object.freeze({posts: [[-8, 6], [-1.5, 8]], height: 2.1, slack: 1.12, postRadius: .09, postColor: 0x6b4f35});
const BRIDGE = Object.freeze({pierColor: 0x7c8b91, shotSpeed: 32, lookHeight: 12, ball: {mass: 35, radius: .65, color: 0xffa54a}});

// camp: {x, z} (from the demo life). bridge: [x, groundY, z, yaw] - the bridge centre, the height of its physics ground
// (a seabed for a bridge in water, so wreckage sinks) and its heading in radians (0 = deck along X, shots come from -Z).
export function createDemoStructures({scene, ground, camp, bridge: [bridgeX, bridgeGround, bridgeZ, bridgeYaw = 0], environment, lighting}) {
  // Boundaries live in a group at the camp so their layout stays in small local coordinates.
  const campGroup = new THREE.Group(); campGroup.position.set(camp.x, 0, camp.z); scene.add(campGroup);
  const boundaries = createBoundaries({scene: campGroup, lighting, sampleGround: (x, z) => ground(x + camp.x, z + camp.z)});
  boundaries.setRuns(RUNS.map(([kind, points]) => makeRun(kind, points)));
  boundaries.setEnvironment(environment);

  const world = new C.World({gravity: new C.Vec3(0, -9.82, 0)}); world.solver.iterations = 32;
  const postGeometry = new THREE.CylinderGeometry(ROPE.postRadius, ROPE.postRadius, ROPE.height, 8), postMaterial = new THREE.MeshStandardMaterial({color: ROPE.postColor, roughness: 1});
  const endpoints = ROPE.posts.map(([dx, dz]) => {
    const x = camp.x + dx, z = camp.z + dz, y = ground(x, z), post = new THREE.Mesh(postGeometry, postMaterial);
    post.position.set(x, y + ROPE.height / 2, z); scene.add(post);
    return {kind: 'fixed', position: [x, y + ROPE.height, z], post};
  });
  const span = Math.hypot(...endpoints[0].position.map((value, i) => value - endpoints[1].position[i]));
  let cable, cableView, cableState, cableTime = 0;
  function hangRope() {
    cableView?.dispose(); cable?.dispose();
    cable = createCable({world, endpoints: endpoints.map(({kind, position}) => ({kind, position})), length: span * ROPE.slack, preset: 'rope'});
    cable.setEnvironment(environment);
    const refresh = () => { cableState = cable.snapshot(); }; refresh(); cable.subscribe(refresh);
    cableView = createThreeCableView({scene, cable: {links: cable.links, profile: cable.profile, get sections() { return cableState.sections; }}});
  }
  hangRope();

  const bridgeGroup = new THREE.Group(); bridgeGroup.position.set(bridgeX, bridgeGround, bridgeZ); bridgeGroup.rotation.y = bridgeYaw; scene.add(bridgeGroup);
  const pierGeometry = new THREE.BoxGeometry(1, 1, 1), pierMaterial = new THREE.MeshStandardMaterial({color: BRIDGE.pierColor});
  const ballGeometry = new THREE.SphereGeometry(BRIDGE.ball.radius, 20, 12), ballMaterial = new THREE.MeshStandardMaterial({color: BRIDGE.ball.color, metalness: .45, roughness: .32});
  const projectile = [{mass: BRIDGE.ball.mass, radius: BRIDGE.ball.radius, position: new THREE.Vector3()}], piers = new THREE.Group(), balls = new Map();
  bridgeGroup.add(piers);
  let demolition, bridgeView, targetId, bridgeTime = 0;
  function buildBridge() {
    bridgeView?.dispose(); demolition?.dispose();
    for (const mesh of balls.values()) bridgeGroup.remove(mesh);
    balls.clear(); piers.clear();
    demolition = createDemolition();
    bridgeView = createThreeStructureView({system: demolition, scene: bridgeGroup});
    targetId = demolition.members.find(member => member.type === 'endpost').id;
    for (const x of [-demolition.span / 2, demolition.span / 2]) {
      const pier = new THREE.Mesh(pierGeometry, pierMaterial), height = demolition.deckY - .25;
      pier.scale.set(2.4, height, demolition.width + 3); pier.position.set(x, height / 2, 0); pier.castShadow = true; piers.add(pier);
    }
    bridgeTime = 0;
  }
  buildBridge();

  let disposed = false;
  return {
    boundaries, bridgeCentre: new THREE.Vector3(bridgeX, bridgeGround + BRIDGE.lookHeight, bridgeZ),
    get rope() { return cable; }, get bridge() { return demolition; },
    cutRope() { cable.breakAt(Math.floor(cable.joints.length / 2)); },
    hangRope,
    fireAtBridge() {
      const body = demolition.launch(projectile, demolition.members[targetId].body.position, {speed: BRIDGE.shotSpeed});
      if (!body) return;
      const mesh = new THREE.Mesh(ballGeometry, ballMaterial); mesh.position.copy(body.position); bridgeGroup.add(mesh); balls.set(body, mesh);
      for (const [old, oldMesh] of balls) if (!demolition.projectiles.includes(old)) { bridgeGroup.remove(oldMesh); balls.delete(old); }
    },
    buildBridge,
    update(dt, camera) {
      if (disposed) return;
      boundaries.update(dt);
      cableTime += dt;
      for (let steps = 0; cableTime >= STEP && steps < MAX_STEPS_PER_FRAME; steps++, cableTime -= STEP) { cable.beforeStep(STEP); world.step(STEP); cable.afterStep(STEP); }
      cableTime %= STEP;
      cableView.update(camera);
      if (demolition.shots > 0) {   // the standing bridge is at rest: no physics until the first shot
        bridgeTime += dt;
        for (let steps = 0; bridgeTime >= STEP && steps < MAX_STEPS_PER_FRAME; steps++, bridgeTime -= STEP) demolition.step(STEP);
        bridgeTime %= STEP;
        bridgeView.update();
        for (const [body, mesh] of balls) mesh.position.copy(body.position);
      }
    },
    dispose() {
      if (disposed) return; disposed = true;
      boundaries.dispose(); scene.remove(campGroup);
      cableView.dispose(); cable.dispose(); for (const {post} of endpoints) scene.remove(post); postGeometry.dispose(); postMaterial.dispose();
      bridgeView.dispose(); demolition.dispose(); scene.remove(bridgeGroup);
      for (const resource of [pierGeometry, pierMaterial, ballGeometry, ballMaterial]) resource.dispose();
    },
  };
}
