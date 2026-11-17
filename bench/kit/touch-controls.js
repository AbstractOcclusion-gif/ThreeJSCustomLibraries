// Bench-only: on-screen controls for a touch screen, the usual way: a stick under the left thumb, buttons under the
// right one, and the rest of the screen left to the page (a finger drag that turns the view). The stick gives a move
// direction; a button presses and releases one of the page's own key codes, so the page keeps one handling for the
// keyboard and for the screen. Sizes are in touch-controls.css; the stick's travel is read from the drawn elements.
import {onLeave} from './page-lifecycle.js';
import './touch-controls.css';

export const TOUCH_DEFAULTS = Object.freeze({
 deadZone: .18,   // share of the stick's travel under which it gives no move
 runFrom: .7,     // share from which it asks for a run
});

// buttons: [{id, label, code, row}]: code is the key code pressed; row 'top' puts a small button in the row at the
// top right (a station, a reset), otherwise it is a large one at the bottom right.
// onPress(code), onRelease(code): the page's own key handling. force: show the controls on any screen (to try them
// with a mouse); otherwise only where the main pointer is a finger.
// Returns {active, move: {x, y} (-1..1, x to the left, y ahead, as the pages' MOVE tables), running, show(id, on), dispose()}.
export function createTouchControls({buttons = [], onPress, onRelease, force = false, ...options} = {}) {
 const unknown = Object.keys(options).filter(key => !(key in TOUCH_DEFAULTS));
 if (unknown.length) throw Error('Unknown touch control option: ' + unknown.join(', '));
 if (typeof onPress !== 'function' || typeof onRelease !== 'function') throw Error('Touch controls need onPress and onRelease');
 const o = {...TOUCH_DEFAULTS, ...options}, move = {x: 0, y: 0};
 const active = force || matchMedia('(pointer: coarse)').matches;
 let running = false;
 if (!active) return {active, move, get running() { return running; }, show() {}, dispose() {}};

 const element = (className, parent, tag = 'div') => { const made = document.createElement(tag); made.className = className; parent.append(made); return made; };
 const root = element('touch-controls', document.body), stick = element('touch-stick', root), knob = element('touch-knob', stick);
 const rows = {top: element('touch-row', root), main: element('touch-buttons', root)};
 document.body.classList.add('touch');

 let stickPointer = null;
 function aim(event) {
  const bounds = stick.getBoundingClientRect(), travel = (bounds.width - knob.offsetWidth) / 2;
  let dx = event.clientX - (bounds.left + bounds.width / 2), dy = event.clientY - (bounds.top + bounds.height / 2);
  const reach = Math.hypot(dx, dy), share = Math.min(1, reach / travel), length = Math.min(reach, travel);
  // The knob stays on the base however far the finger goes.
  if (reach > travel) { dx *= travel / reach; dy *= travel / reach; }
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
  // Past the dead zone the move grows from 0 to 1; the screen's right and down are the pages' -x and -y.
  const strength = share <= o.deadZone ? 0 : (share - o.deadZone) / (1 - o.deadZone);
  move.x = length ? -dx / length * strength : 0;
  move.y = length ? -dy / length * strength : 0;
  running = share >= o.runFrom;
 }
 function rest() { stickPointer = null; move.x = move.y = 0; running = false; knob.style.transform = ''; }
 const stickDown = event => { if (stickPointer !== null) return; event.preventDefault(); stickPointer = event.pointerId; stick.setPointerCapture(event.pointerId); aim(event); };
 const stickMove = event => { if (event.pointerId === stickPointer) aim(event); };
 const stickUp = event => { if (event.pointerId === stickPointer) rest(); };
 const stickListeners = {pointerdown: stickDown, pointermove: stickMove, pointerup: stickUp, pointercancel: stickUp, lostpointercapture: stickUp};
 for (const [type, listener] of Object.entries(stickListeners)) stick.addEventListener(type, listener);

 const made = new Map(), held = new Map();   // button by id; the code each pointer holds down
 for (const {id, label, code, row} of buttons) {
  const button = element('touch-button', rows[row === 'top' ? 'top' : 'main'], 'button');
  button.type = 'button'; button.textContent = label;
  const down = event => { event.preventDefault(); if (held.has(event.pointerId)) return; held.set(event.pointerId, code); button.setPointerCapture(event.pointerId); button.classList.add('held'); onPress(code); };
  const up = event => { if (!held.delete(event.pointerId)) return; button.classList.remove('held'); onRelease(code); };
  const listeners = {pointerdown: down, pointerup: up, pointercancel: up, lostpointercapture: up};
  for (const [type, listener] of Object.entries(listeners)) button.addEventListener(type, listener);
  made.set(id, button);
 }
 // The page lost the screen: nothing stays held.
 function blur() { rest(); for (const code of held.values()) onRelease(code); held.clear(); for (const button of made.values()) button.classList.remove('held'); }
 addEventListener('blur', blur);
 let disposed = false;
 function dispose() {
  if (disposed) return;
  disposed = true;
  removeEventListener('blur', blur);
  blur();
  root.remove();
  document.body.classList.remove('touch');
 }
 onLeave(dispose);
 return {
  active, move,
  get running() { return running; },
  // Shows or hides a button, for one that only makes sense now and then (a swing while she holds a rope).
  show(id, on) {
   const button = made.get(id);
   if (!button) throw Error('Unknown touch button: ' + id);
   button.hidden = !on;
  },
  dispose,
 };
}
