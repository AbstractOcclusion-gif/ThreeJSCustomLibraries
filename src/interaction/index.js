export function createInteraction() {
  const targets = new Map();
  let focused = null;
  let pressed = false;
  let hold = null;

  function available() {
    return focused && (focused.available?.() ?? true);
  }

  function cancel() {
    hold = null;
    pressed = false;
  }

  return {
    register(id, {prompt, activate, available, holdSeconds = 0}) {
      if (targets.has(id)) throw new Error('Duplicate interaction target: ' + id);
      if (!Number.isFinite(holdSeconds) || holdSeconds < 0) throw new RangeError('Invalid hold duration');
      const target = {id, prompt, activate, available, holdSeconds};
      targets.set(id, target);
      return () => {
        if (targets.get(id) !== target) return;
        targets.delete(id);
        if (focused === target) {
          focused = null;
          hold = null;
        }
      };
    },
    focus(id) {
      const next = targets.get(id) ?? null;
      if (next !== focused) hold = null;
      focused = next;
    },
    get status() {
      if (!focused) return null;
      return {
        id: focused.id, prompt: focused.prompt, available: Boolean(available()),
        holdSeconds: focused.holdSeconds, progress: hold ? hold.elapsed / focused.holdSeconds : 0,
      };
    },
    press() {
      if (pressed) return;
      pressed = true;
      if (!available()) return;
      if (focused.holdSeconds > 0) hold = {elapsed: 0};
      else focused.activate();
    },
    release: cancel,
    cancel,
    update(seconds) {
      if (!hold) return;
      if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Invalid interaction duration');
      if (!available()) {
        hold = null;
        return;
      }
      hold.elapsed += seconds;
      if (hold.elapsed >= focused.holdSeconds) {
        hold = null;
        focused.activate();
      }
    },
  };
}
