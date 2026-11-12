# Save and load

Use `createSaveStore({schema, version, validate, migrations, storage, prefix})`
from `@abstractocclusion/three-kit/save`. The host supplies JSON-compatible
game state and a storage adapter implementing `getItem`, `setItem`, and
`removeItem`. Pass browser localStorage for browser slots or a memory adapter
for tests. Use `encode(data)` and `decode(file)` independently of storage.

`save(slot, data)` writes a versioned file. `load(slot)` returns validated data
or null for an empty slot. Invalid, incompatible, or unreadable files throw.
Migration functions are keyed by source version. Each returns data for the
next version. Loading leaves the original slot intact until the host saves.

Save puzzle snapshots and other plain game data in one payload. Restore scene
state through the owning tools after validation. The module also exports
`downloadJson` and `readJsonFile` for browser import and export.

Open **Save & Load** in the bench, change the sample state, and save it to one
of the two slots. Change the fields and load the slot to restore its state.
