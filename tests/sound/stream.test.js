import test from 'node:test';
import assert from 'node:assert/strict';
import {createSound} from '../../src/sound/index.js';

// A stand-in Web Audio graph: nodes remember what they feed, params what they were told.
function fakeContext() {
  const param = value => ({value, events: [], cancelScheduledValues() {}, cancelAndHoldAtTime() {},
    setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v, t) { this.events.push([v, t]); this.value = v; }});
  const node = extra => ({outputs: [], connect(next) { this.outputs.push(next); return next; }, disconnect() { this.outputs = []; this.disconnected = true; }, ...extra});
  return {
    currentTime: 0, destination: node(), sources: [],
    createGain() { return node({gain: param(1)}); },
    createAnalyser() { return node({fftSize: 0, getFloatTimeDomainData() {}}); },
    createMediaElementSource(element) { const source = node({element}); this.sources.push(source); return source; },
    resume: async () => {}, close: async () => {},
  };
}
const fakeElement = () => ({played: 0, paused: false, play() { this.played++; return Promise.resolve(); }, pause() { this.paused = true; }});

test('a stream plays an element through a bus, fades in and out, and goes when the engine does', async () => {
  const context = fakeContext(), sound = createSound({context}), element = fakeElement();
  assert.throws(() => sound.stream('/a.mp3', {bus: 'nowhere', element}), /Unknown sound bus/);
  const music = sound.stream('/track.mp3', {gain: .6, fadeSeconds: 2, element});
  await music.started;
  assert.equal(element.src, '/track.mp3'); assert.equal(element.loop, true); assert.equal(element.played, 1);
  const [source] = context.sources, fader = source.outputs[0];
  assert.equal(source.element, element);
  assert.deepEqual(fader.gain.events.at(-1), [.6, 2]);   // faded in from 0 over 2 s
  assert.equal(music.ended, false);
  music.setGain(.2, 0); assert.equal(fader.gain.value, .2);
  music.stop();
  assert.equal(music.ended, true); assert.equal(element.paused, true); assert.ok(source.disconnected);
  const again = sound.stream('/track.mp3', {element: fakeElement(), loop: false});
  assert.equal(again.element.loop, false);
  await sound.dispose();
  assert.equal(again.ended, true);
  assert.throws(() => sound.stream('/x.mp3', {element: fakeElement()}), /disposed/);
});
