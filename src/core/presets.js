// Tiny JSON preset helpers shared by the benches: validate a schema tag, download, read a chosen file.
export function presetFile(schema, version, data) {
  return {schema, version, ...data};
}
export function assertPreset(value, schema, version) {
  if (value?.schema !== schema || value.version !== version) throw Error(`Expected ${schema} v${version} preset`);
  return value;
}
export function downloadJson(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function readJsonFile(file) { return JSON.parse(await file.text()); }
