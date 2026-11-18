import {Vector3, MathUtils} from 'three';
import {createCameraCollision, createCameraDirector, createThirdPersonRig} from '../../src/camera/index.js';
import {shortestTurn} from '../../src/character/angles.js';

// How the view follows her. Lengths in m, speeds in m/s, rates in 1/s (higher = tighter), angles in rad.
const FOLLOW = {
 lead: .32,            // how far past her the view aims, along the way it looks
 shoulder: .35,        // how far to her right the view aims, so she stands left of centre and the way ahead shows
 shoulderSkin: .2,     // kept between that aim point and a wall beside her
 hangHeight: 1.54,     // aim height above her feet while she hangs or climbs
 hangDistance: .85,    // share of the arm kept then
 side: 14,             // how tightly the aim follows her over the ground at a standstill ...
 sideRun: 5.5,         // ... and at run speed: looser, so the view trails her as she speeds up and glides in as she stops
 sideEase: 3,          // how fast it goes from one to the other
 rise: 9,              // how tightly it follows her height
 settle: 6,            // how fast lead, shoulder and arm ease when she grabs a ledge or lets go
 airUp: .9,            // a jump may rise this far above where it started before the view moves up with it
 airDown: .3,          // and she may drop this far below before it moves down
 recentreAfter: .5,    // s without a look input before the view starts drifting behind her
 recentreRate: 2.6,    // how fast it drifts at run speed; 0 = the view never moves on its own
 recentreEase: 1.6,    // how fast that drift picks up and dies down (1/s), so it never starts or stops abruptly
 recentreFrom: .5,     // she has to move at least this fast for it to drift
 recentreFacing: -.5,  // cosine between the view and her heading under which she runs at the camera: the view stays put
 kickFrom: 5,          // landing speed where the view starts to shake
 kickFull: 10,         // landing speed of the full shake
 kick: .1,             // strength of the full shake
 kickSeconds: .22,     // how long it lasts
 zoomRate: .001,       // zoom per wheel unit
 zoomMin: .67,         // closest and farthest zoom, as shares of the arm
 zoomMax: 1.5,
};
// Clearance kept around the camera and off whatever it hits.
const COLLISION = {radius: .32, skin: .22};

export function createFollowCamera(camera, host, view) {
 const orbit = createThirdPersonRig(view);
 const raycast = (from, to) => host.raycast(from, to)?.distance ?? Infinity;
 const collision = createCameraCollision({raycast, ...COLLISION});
 const director = createCameraDirector(camera).register('look', orbit);
 director.setCollision(collision);
 const target = new Vector3(), chest = new Vector3(), beside = new Vector3();
 const data = {target, distance: 1};
 let ready = false, zoom = 1, free = 1, shoulder = 0, floor = 0, quiet = 0, drift = 0, side = FOLLOW.side;
 return {
  get yaw() { return orbit.yaw; },
  // A look input from the player; the view waits before drifting on its own again.
  look(yaw, pitch) { orbit.look(yaw, pitch); quiet = 0; },
  zoom(delta) { zoom = MathUtils.clamp(zoom * Math.exp(delta * FOLLOW.zoomRate), FOLLOW.zoomMin, FOLLOW.zoomMax); },
  // speed: m/s she came down at.
  land(speed) {
   const share = MathUtils.smoothstep(speed, FOLLOW.kickFrom, FOLLOW.kickFull);
   if (share > 0) director.shake({strength: FOLLOW.kick * share, duration: FOLLOW.kickSeconds});
  },
  reset() { director.reset(); ready = false; quiet = drift = 0; side = FOLLOW.side; },
  // position: her feet as drawn. heading (rad), speed (m/s over the ground), runSpeed (m/s), action: the ledge state.
  update(dt, {position, heading, speed, runSpeed, action, grounded}) {
   const hanging = action !== 'free';
   const ease = rate => ready ? 1 - Math.exp(-dt * rate) : 1;
   quiet += dt;
   const turn = shortestTurn(heading - orbit.yaw);
   const drifting = ready && !hanging && grounded && quiet > FOLLOW.recentreAfter && speed > FOLLOW.recentreFrom && Math.cos(turn) > FOLLOW.recentreFacing;
   drift = MathUtils.lerp(drift, drifting ? Math.min(1, speed / runSpeed) : 0, ease(FOLLOW.recentreEase));
   if (ready && drift > .001) orbit.look(turn * (1 - Math.exp(-dt * FOLLOW.recentreRate * drift)), 0);
   free = MathUtils.lerp(free, hanging ? 0 : 1, ease(FOLLOW.settle));
   const sin = Math.sin(orbit.yaw), cos = Math.cos(orbit.yaw);
   // The view's right is (-cos, sin) on X/Z. The shoulder aim never passes a wall beside her.
   chest.set(position.x, position.y + view.height, position.z);
   beside.set(chest.x - cos * (FOLLOW.shoulder + FOLLOW.shoulderSkin), chest.y, chest.z + sin * (FOLLOW.shoulder + FOLLOW.shoulderSkin));
   const room = Math.min(FOLLOW.shoulder, Math.max(0, raycast(chest, beside) - FOLLOW.shoulderSkin)) * free;
   shoulder = Math.min(room, MathUtils.lerp(shoulder, room, ease(FOLLOW.settle)));
   side = MathUtils.lerp(side, MathUtils.lerp(FOLLOW.side, FOLLOW.sideRun, hanging ? 0 : MathUtils.smoothstep(speed / runSpeed, .3, 1)), ease(FOLLOW.sideEase));
   const lead = FOLLOW.lead * free, follow = ease(side);
   target.x = MathUtils.lerp(target.x, position.x + sin * lead - cos * shoulder, follow);
   target.z = MathUtils.lerp(target.z, position.z + cos * lead + sin * shoulder, follow);
   // On the ground or a ledge the view follows her feet; in the air it waits until she leaves the band around take-off.
   floor = !ready || hanging || grounded ? position.y : MathUtils.clamp(floor, position.y - FOLLOW.airUp, position.y + FOLLOW.airDown);
   target.y = MathUtils.lerp(target.y, floor + (hanging ? FOLLOW.hangHeight : view.height), ease(FOLLOW.rise));
   data.distance = MathUtils.lerp(data.distance, zoom * (hanging ? FOLLOW.hangDistance : 1), ease(FOLLOW.settle));
   director.update(dt, data);
   ready = true;
  },
 };
}
