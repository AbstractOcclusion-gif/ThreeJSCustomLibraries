export function createSequenceRule(actions) {
  const sequence = [...actions];
  if (!sequence.length || sequence.some(action => typeof action !== 'string' || !action)) {
    throw new Error('A puzzle sequence needs action IDs');
  }

  return {
    initial: () => 0,
    step(index, input) {
      if (input.type !== 'action' || index === sequence.length) return index;
      if (input.action === sequence[index]) return index + 1;
      return input.action === sequence[0] ? 1 : 0;
    },
    solved: index => index === sequence.length,
    progress: index => index / sequence.length,
    validate: index => Number.isInteger(index) && index >= 0 && index <= sequence.length,
  };
}

export function createConditionRule({test, holdSeconds = 0}) {
  if (!Number.isFinite(holdSeconds) || holdSeconds < 0) throw new RangeError('Invalid condition duration');
  const empty = () => ({met: false, elapsed: 0});
  return {
    initial: empty,
    step(state, input) {
      if (input.type !== 'observation') return state;
      const met = Boolean(test(input.values));
      const elapsed = met ? Math.min(holdSeconds, state.elapsed + input.seconds) : 0;
      return met === state.met && elapsed === state.elapsed ? state : {met, elapsed};
    },
    solved: ({met, elapsed}) => met && elapsed >= holdSeconds,
    progress: ({met, elapsed}) => holdSeconds > 0 ? elapsed / holdSeconds : Number(met),
    validate: state => state && typeof state.met === 'boolean' && Number.isFinite(state.elapsed)
      && state.elapsed >= 0 && state.elapsed <= holdSeconds && (state.met || state.elapsed === 0),
  };
}
