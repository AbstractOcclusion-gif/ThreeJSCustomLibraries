export {createSequenceRule, createConditionRule} from './rules.js';

const SNAPSHOT_VERSION = 1;

// Hooks: subscribe(listener) hears 'puzzle:changed' ({id, solved, wasSolved, progress}); an onChange option is its
// first listener.
export function createPuzzle({id, rule, latch = true, onChange}) {
  let state = rule.initial();
  let solved = false;
  const listeners = new Set(onChange ? [onChange] : []);
  const tell = wasSolved => {
    const event = Object.freeze({type: 'puzzle:changed', id, solved, wasSolved, progress: rule.progress(state)});
    for (const listener of listeners) listener(event);
  };

  function commit(next) {
    const wasSolved = solved;
    solved = Boolean((latch && solved) || rule.solved(next));
    const changed = next !== state || wasSolved !== solved;
    state = next;
    if (changed) tell(wasSolved);
  }

  function apply(input) {
    if (!solved || !latch) commit(rule.step(state, input));
  }

  return {
    subscribe(listener) {
      if (typeof listener !== 'function') throw Error('Puzzle listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() { listeners.clear(); },
    get solved() { return solved; },
    get progress() { return rule.progress(state); },
    act(action, value) { apply({type: 'action', action, value}); },
    observe(values, seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Invalid observation duration');
      apply({type: 'observation', values, seconds});
    },
    reset() {
      const wasSolved = solved;
      solved = false;
      state = rule.initial();
      tell(wasSolved);
    },
    snapshot() { return {version: SNAPSHOT_VERSION, id, state: structuredClone(state)}; },
    restore(snapshot) {
      if (snapshot?.version !== SNAPSHOT_VERSION || snapshot.id !== id || !rule.validate(snapshot.state)) {
        throw new Error('Invalid puzzle snapshot: ' + id);
      }
      const next = structuredClone(snapshot.state);
      const wasSolved = solved;
      state = next;
      solved = Boolean(rule.solved(state));
      tell(wasSolved);
    },
  };
}
