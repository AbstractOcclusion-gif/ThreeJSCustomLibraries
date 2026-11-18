// The actions that can carry the character, held in the order they take her. One contract for all of them:
//   state    'free' while the action leaves her to move herself, any other name while it carries her
//   update   update(dt, input, step) -> true while it carries her: nothing after it runs that step
//   reset    reset() lets go of her
// The last action added is the one she is in when no other holds her: it is handed `step`, to move her itself.
// An action may also `take` her: once every action has left her free, each take is tried in turn until one does.
const CONTRACT = ['update', 'reset'];

export function createActionSet() {
  const entries = [];
  return {
    // input(intent) -> what this action's update reads. take(intent) -> true when it has just caught her.
    add(name, action, {input = intent => intent, take = null} = {}) {
      if (typeof name !== 'string' || !name) throw Error('A character action needs a name');
      if (entries.some(entry => entry.name === name)) throw Error(`Character action "${name}" was already added`);
      for (const method of CONTRACT) if (typeof action?.[method] !== 'function') throw Error(`Character action "${name}" has no ${method}()`);
      if (typeof action.state !== 'string') throw Error(`Character action "${name}" has no state`);
      entries.push({name, action, input, take});
      return this;
    },
    // The action that holds her, else the last one added.
    get carrier() {
      if (!entries.length) throw Error('No character action was added');
      return (entries.find(entry => entry.action.state !== 'free') ?? entries.at(-1)).action;
    },
    get free() { return this.carrier.state === 'free'; },
    // One physics step. Returns the name of the action that carried her, or null.
    update(dt, intent, step) {
      for (const {name, action, input} of entries) if (action.update(dt, input(intent), step) === true) return name;
      if (this.free) for (const {take} of entries) if (take?.(intent)) break;
      return null;
    },
    reset() { for (const {action} of entries) action.reset(); },
  };
}
