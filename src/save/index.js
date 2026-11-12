import {assertPreset, presetFile} from '../core/presets.js';

export {downloadJson, readJsonFile} from '../core/presets.js';

export function createSaveStore({schema, version, validate, migrations = {}, storage, prefix = schema}) {
  if (typeof schema !== 'string' || !schema || !Number.isSafeInteger(version) || version < 1) {
    throw new TypeError('Save storage needs a schema and positive version');
  }

  function check(data) {
    if (validate && !validate(data)) throw new Error('Invalid save data for ' + schema);
    return data;
  }

  function decode(file) {
    let current = file?.version;
    assertPreset(file, schema, current);
    if (!Number.isSafeInteger(current) || current < 1 || current > version || !Object.hasOwn(file, 'data')) {
      throw new Error('Unsupported save version for ' + schema);
    }
    let data = structuredClone(file.data);
    while (current < version) {
      const migrate = Object.hasOwn(migrations, current) && migrations[current];
      if (typeof migrate !== 'function') throw new Error('Missing save migration from v' + current);
      data = migrate(data);
      current++;
    }
    return check(data);
  }

  function key(slot) {
    if (typeof slot !== 'string' || !slot.trim()) throw new TypeError('Save slot needs a name');
    return JSON.stringify([prefix, schema, slot]);
  }

  function encode(data) {
    const json = JSON.stringify(data);
    if (json === undefined) throw new TypeError('Save data must be JSON serializable');
    return presetFile(schema, version, {data: check(JSON.parse(json))});
  }

  return {
    encode, decode,
    save(slot, data) {
      const file = encode(data);
      storage.setItem(key(slot), JSON.stringify(file));
      return file;
    },
    load(slot) {
      const json = storage.getItem(key(slot));
      return json === null ? null : decode(JSON.parse(json));
    },
    remove(slot) { storage.removeItem(key(slot)); },
  };
}
