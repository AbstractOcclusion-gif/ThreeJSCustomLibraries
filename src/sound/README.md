# Sound

Use `@abstractocclusion/three-kit/sound` in a browser with Web Audio. The optional
`@abstractocclusion/three-kit/sound/three` adapter takes ordinary Three.js objects.
Open **Sound** from the module bench (`/bench/?tool=sound`) for a self-contained
playground with generated clips.

```js
import {createSound, createAmbience, SOUND_PRESETS} from '@abstractocclusion/three-kit/sound';

const sound = createSound();
enableButton.addEventListener('click', async () => {
  await sound.unlock();
  const [wind, rain, click, impulse] = await Promise.all(
    ['/wind.ogg', '/rain.ogg', '/click.ogg', '/cave.wav'].map(sound.load),
  );
  sound.define('wind', {buffer: wind, bus: 'ambience'});
  sound.define('rain', {buffer: rain, bus: 'ambience'});
  sound.define('click', {buffer: click, bus: 'ui', maxVoices: 4, pitchCents: 30});
  const weather = createAmbience(sound, {
    layers: [{id: 'wind', sound: 'wind', gain: 0}, {id: 'rain', sound: 'rain', gain: 0}],
  });
  const water = sound.addEnvironmentFilter({...SOUND_PRESETS.underwater, cutoffHz: 650});
  const cave = sound.addEnvironmentReverb({...SOUND_PRESETS.cave, impulse});
  weather.start();

  // Call when the host's mapped weather or zone levels change.
  function setConditions({windLevel, rainLevel, submersion, caveBlend}) {
    weather.setLevel('wind', windLevel);
    weather.setLevel('rain', rainLevel);
    water.setBlend(submersion);
    cave.setBlend(caveBlend);
  }
  // Wire setConditions and sound.play('click') into your application.
}, {once: true});
```

Use normalized weather gains chosen by the host. For example, map wind speed in
m/s to a gain curve and use rain intensity to control the rain layer. Play
thunder as a one-shot when the host signals a strike, or add optional ambience
`cues` with `{sound, intervalSeconds: [min, max], options}` and call
`ambience.update()` each frame. Start and stop ambience groups with a shared
`fadeSeconds` to crossfade. Load seamless clips for loops.

Default routing is `music / ambience / sfx → world → master` and
`ui → master`. `sound.addBus(id, {parent, gain})` adds a child to any existing
bus. `sound.bus(id).setMix({gain, mute, solo}, fadeSeconds)` changes the mix.
`meter()` returns post-fader RMS. An injected `context` and optional
`destination` let a host reuse its audio graph. Dispose the sound engine when
leaving the scene. The host owns the lifecycle of an injected context.

## Spatial audio

```js
import {createThreeSound} from '@abstractocclusion/three-kit/sound/three';

const spatial = createThreeSound(sound, {listener: camera, metersPerUnit: 1});
const voice = sound.play('machine', {loop: true, spatial: {panner: {refDistance: 3}}});
const detach = spatial.attach(voice, machineObject);
spatial.update(); // Each frame, after the host updates transforms.
```

Define and load `machine` before playing it. Use `spatial.setListener(camera)`
when changing cameras. Emitters use their object's positive Z axis for
directional cones. With the standalone engine, pass positions and directions as
`{x, y, z}` to `sound.setListener` and `voice.setPose`. Call `detach()` to
stop tracking the object, `voice.stop(fadeSeconds)` to end playback, and
`spatial.dispose()` when tearing down the adapter.

## Effects and presets

Effect chains are serial and are attached before the bus fader. The built-in
`filter` supports the native biquad types, including EQ types. `compressor`,
`delay` and `reverb` are also available. Reverb mixes convolution alongside
the dry signal and takes a decoded impulse response.

```js
sound.registerEffect('radio', (context, {cutoffHz, q}) => {
  const node = context.createBiquadFilter();
  node.type = 'bandpass';
  node.frequency.value = cutoffHz;
  node.Q.value = q;
  return {input: node, output: node, params: {cutoffHz: node.frequency}};
});
const radio = sound.bus('sfx').addEffect('radio', {cutoffHz: 1100, q: 4});
radio.set('cutoffHz', 1600);
radio.remove();
```

A factory can return a `dispose()` method to release its internal resources.
Give each effect its own nodes and let the mixer connect its output. Use
`SOUND_DEFAULTS` and `SOUND_PRESETS` as references for project-owned settings.
Pass overrides through `createSound({defaults})`, a sound definition, bus
settings, or effect options.
