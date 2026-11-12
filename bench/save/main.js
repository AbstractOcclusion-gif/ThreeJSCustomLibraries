import {createSaveStore, downloadJson, readJsonFile} from '../../src/save/index.js';
import '../bench.css';

const element = id => document.getElementById(id);
const store = createSaveStore({
  schema: 'three-kit-save-bench', version: 1, storage: localStorage,
  validate: data => Number.isSafeInteger(data?.shells) && data.shells >= 0 && typeof data.gate === 'boolean',
});
const capture = () => ({shells: element('shells').valueAsNumber, gate: element('gate').checked});
function restore(data) {
  element('shells').value = data.shells;
  element('gate').checked = data.gate;
}
function report(message) { element('status').textContent = message; }
function action(id, run) {
  element(id).onclick = () => {
    try { run(element('slot').value); } catch (error) { report(error.message); }
  };
}
action('save', slot => { store.save(slot, capture()); report('Saved ' + slot); });
action('load', slot => {
  const data = store.load(slot);
  if (data) restore(data);
  report(data ? 'Loaded ' + slot : 'Slot is empty');
});
action('export', slot => downloadJson(slot.toLowerCase() + '-save.json', store.encode(capture())));
element('import').onchange = async event => {
  const input = event.currentTarget;
  if (!input.files.length) return;
  try {
    restore(store.decode(await readJsonFile(input.files[0])));
    report('Imported save');
  } catch (error) {
    report(error.message);
  } finally {
    input.value = '';
  }
};
