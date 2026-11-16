// A Jolt world as a core service, for the tools that need rigid bodies (character, vehicle, destruction). A tool takes
// a Jolt interface from its host; a host that has none of its own makes one here, so a tool also runs on its own. The
// caller passes J, the initialised jolt-physics module: core imports no physics package.
// Object layers: 0 is the fixed scenery, 1 the moving bodies; a host that needs more passes layerCount and which
// pairs collide. Every layer but the first lies in the moving broad phase.
export const JOLT_LAYERS = Object.freeze({fixed: 0, moving: 1});
export const JOLT_HOST_DEFAULTS = Object.freeze({
  gravity: 9.82,                                  // m/s2, along -Y
  maxBodies: 8192, maxBodyPairs: 32768, maxContactConstraints: 8192,
  layerCount: 2,
  collide: Object.freeze([[JOLT_LAYERS.fixed, JOLT_LAYERS.moving], [JOLT_LAYERS.moving, JOLT_LAYERS.moving]]),
  friction: .6,                                   // of the boxes addBox makes
});
const BROAD_PHASE_LAYERS = 2;       // fixed and moving
const BOX_CONVEX_RADIUS = .005;     // m, rounding of a box's edges

export function createJoltHost(J, options = {}) {
  if (!J?.JoltInterface) throw Error('Jolt host needs J, the initialised jolt-physics module');
  const unknown = Object.keys(options).filter(key => !(key in JOLT_HOST_DEFAULTS) && key !== 'workerThreads');
  if (unknown.length) throw Error('Unknown Jolt host option: ' + unknown.join(', '));
  const o = {...JOLT_HOST_DEFAULTS, ...options};
  const settings = new J.JoltSettings();
  settings.mMaxBodies = o.maxBodies; settings.mMaxBodyPairs = o.maxBodyPairs; settings.mMaxContactConstraints = o.maxContactConstraints;
  if (o.workerThreads !== undefined) settings.mMaxWorkerThreads = o.workerThreads;
  const pairs = new J.ObjectLayerPairFilterTable(o.layerCount);
  for (const [a, b] of o.collide) pairs.EnableCollision(a, b);
  const broad = new J.BroadPhaseLayerInterfaceTable(o.layerCount, BROAD_PHASE_LAYERS), fixed = new J.BroadPhaseLayer(0), moving = new J.BroadPhaseLayer(1);
  for (let layer = 0; layer < o.layerCount; layer++) broad.MapObjectToBroadPhaseLayer(layer, layer === JOLT_LAYERS.fixed ? fixed : moving);
  settings.mObjectLayerPairFilter = pairs; settings.mBroadPhaseLayerInterface = broad;
  settings.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(broad, BROAD_PHASE_LAYERS, pairs, o.layerCount);
  const jolt = new J.JoltInterface(settings);
  J.destroy(settings); J.destroy(fixed); J.destroy(moving);
  const system = jolt.GetPhysicsSystem(), bodies = system.GetBodyInterface();
  const vector = new J.Vec3(0, -o.gravity, 0), place = new J.RVec3(0, 0, 0), turn = new J.Quat(0, 0, 0, 1);
  system.SetGravity(vector);

  // Ray casts, for a host that asks what lies between two points (a camera, a foot).
  const ray = new J.RRayCast(), raySettings = new J.RayCastSettings(), closest = new J.CastRayClosestHitCollisionCollector();
  const anyBroadPhase = new J.BroadPhaseLayerFilter(), anyLayer = new J.ObjectLayerFilter(), anyBody = new J.BodyFilter(), anyShape = new J.ShapeFilter();
  const hit = {distance: 0, point: {x: 0, y: 0, z: 0}, normal: {x: 0, y: 1, z: 0}};
  let disposed = false;

  return {
    J, jolt, system, bodies, layers: JOLT_LAYERS,
    // A box body. halfExtents, position: [x, y, z]; quaternion: [x, y, z, w]; mass kg, 0 = fixed scenery.
    addBox({halfExtents, position = [0, 0, 0], quaternion = [0, 0, 0, 1], mass = 0, friction = o.friction}) {
      vector.Set(...halfExtents);
      const shape = new J.BoxShape(vector, BOX_CONVEX_RADIUS, null);
      place.Set(...position); turn.Set(...quaternion);
      const creation = new J.BodyCreationSettings(shape, place, turn, mass > 0 ? J.EMotionType_Dynamic : J.EMotionType_Static, mass > 0 ? JOLT_LAYERS.moving : JOLT_LAYERS.fixed);
      creation.mFriction = friction;
      if (mass > 0) {
        creation.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
        creation.mMassPropertiesOverride.mMass = mass;
      }
      const body = bodies.CreateBody(creation);
      J.destroy(creation);
      bodies.AddBody(body.GetID(), mass > 0 ? J.EActivation_Activate : J.EActivation_DontActivate);
      return body;
    },
    remove(body) { bodies.RemoveBody(body.GetID()); bodies.DestroyBody(body.GetID()); },
    // Copies a body's pose into {x, y, z} and {x, y, z, w} targets (Three vectors and quaternions fit).
    readPose(body, position, quaternion) {
      const at = body.GetPosition();
      position.x = at.GetX(); position.y = at.GetY(); position.z = at.GetZ();
      const rotation = body.GetRotation();
      quaternion.x = rotation.GetX(); quaternion.y = rotation.GetY(); quaternion.z = rotation.GetZ(); quaternion.w = rotation.GetW();
    },
    // The nearest surface between two points {x, y, z}: {distance, point, normal} (reused between calls), or null.
    raycast(from, to) {
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
      place.Set(from.x, from.y, from.z); ray.mOrigin = place;
      vector.Set(dx, dy, dz); ray.mDirection = vector;
      closest.Reset();
      system.GetNarrowPhaseQuery().CastRay(ray, raySettings, closest, anyBroadPhase, anyLayer, anyBody, anyShape);
      if (!closest.HadHit()) return null;
      const found = closest.mHit, fraction = found.mFraction;
      hit.distance = Math.hypot(dx, dy, dz) * fraction;
      hit.point.x = from.x + dx * fraction; hit.point.y = from.y + dy * fraction; hit.point.z = from.z + dz * fraction;
      place.Set(hit.point.x, hit.point.y, hit.point.z);
      const normal = system.GetBodyLockInterfaceNoLock().TryGetBody(found.mBodyID).GetWorldSpaceSurfaceNormal(found.mSubShapeID2, place);
      hit.normal.x = normal.GetX(); hit.normal.y = normal.GetY(); hit.normal.z = normal.GetZ();
      return hit;
    },
    step(dt, collisionSteps = 1) { jolt.Step(dt, collisionSteps); },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const object of [ray, raySettings, closest, anyBroadPhase, anyLayer, anyBody, anyShape, vector, place, turn]) J.destroy(object);
      J.destroy(jolt);
    },
  };
}
