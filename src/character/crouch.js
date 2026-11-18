// Keeps the character low: crouched for as long as she is asked to, or for the length of a slide. It only sets the
// controller's capsule height; the page plays the clips. Lengths in m, speeds in m/s.
export const CROUCH_DEFAULTS = Object.freeze({
  height: 1,       // capsule height while she is low
  slideFrom: 3.5,  // asked to crouch at this speed or faster, she slides first
});

// controller: the character controller. standing: its capsule height on her feet.
export function createCrouch({controller, standing, ...options}) {
  const o = {...CROUCH_DEFAULTS, ...options};
  if (!(o.height > 0 && o.height < standing)) throw Error('Crouch height must be above zero and under the standing height');
  let crouched = false, sliding = 0;   // whether she keeps low, and s left of a slide
  return {
    get low() { return controller.height < standing; },
    get sliding() { return sliding > 0; },
    // She crouches, or stands up again. slide: {seconds, speed} of the slide she starts with when she is fast enough.
    toggle(slide = null) {
      if (!controller.grounded || controller.committed) return;
      if (!crouched && slide && controller.speed >= o.slideFrom) { sliding = slide.seconds; controller.commit(slide.seconds, slide.speed); }
      else crouched = !crouched;
    },
    // Each physics step. free: nothing else carries her. She stands up once she is asked to and has the room: under
    // something she stays down.
    update(dt, free) {
      sliding = Math.max(0, sliding - dt);
      if (!free) { crouched = false; sliding = 0; }
      if (!controller.setHeight(crouched || sliding > 0 ? o.height : standing)) crouched = true;
    },
    reset() { crouched = false; sliding = 0; controller.setHeight(standing); },
  };
}
