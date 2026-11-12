# Interaction and puzzles

Import `createInteraction` from `@abstractocclusion/three-kit/interaction`
and `createPuzzle` from `@abstractocclusion/three-kit/puzzle`. Each works
without a scene or browser. The optional `interaction/three` entry picks
registered objects from a camera and normalized pointer coordinates.

Register a stable target ID with `{prompt, activate, available, holdSeconds}`.
The host calls `focus(id)`, `press()`, `update(dtSeconds)`, and `release()`.
Use `status` for prompt, availability, and normalized hold progress. Losing
focus or availability interrupts the hold. The next activation requires a
fresh press. Use `cancel()` when input is interrupted, such as on window blur.

The Three.js picker takes an optional `maxDistance` in scene units. Call
`bind(object, id)` for targets and `block(object)` for occluding geometry.
Both return unregister functions. Update object and camera world matrices
before picking. Call `interaction.focus(picker.pick(camera, pointer))`.

## Connect a puzzle

```js
const gate = createPuzzle({
  id: 'counterweight',
  latch: false,
  rule: createConditionRule({
    test: ({massKg}) => massKg >= settings.requiredKg,
    holdSeconds: settings.settleSeconds,
  }),
});

// Once per simulation tick, after the host updates its measurements.
gate.observe({massKg: plate.supportedMassKg}, dtSeconds);
gateView.setOpen(gate.solved);
```

Feed water level, cable tension, contact count, or other readings through the
same observation API. The host chooses units, timing, and where readings come
from. With `latch: false`, a false reading resets the elapsed time and closes
the gate. The default latches the first success until reset. For a live rule,
supply current readings after restoring a snapshot.

Use `createSequenceRule(['amber', 'blue', 'green'])` and `puzzle.act(id)` for
an ordered set of actions. An unexpected action clears progress unless it
starts the sequence again. A custom rule supplies `initial()`,
`step(state, input)`, `solved(state)`, `progress(state)`, and
`validate(state)`. Return the previous state for unchanged inputs and use
plain, serializable values for new state. Input has either
`{type: 'action', action, value}` or `{type: 'observation', values, seconds}`.

`snapshot()` returns the puzzle ID, snapshot version, and rule state.
`restore(snapshot)` validates them against the active rule. Use stable IDs
and keep the rule definition associated with its save data. The host saves
world state, such as where the weights were placed, alongside puzzle state.

## Bench playtest

Open **Interaction & Puzzles** from the bench. Pull amber, blue, and green.
Release the latch early and check that the gate stays closed. Toggle the
screen to block the latch, then clear it and hold the latch to open the gate.
Move the 2 kg and 4 kg weights onto the plate to open the second gate after
the settling period. Remove either weight to close it. The bench simulates
plate load from the placed weights.
