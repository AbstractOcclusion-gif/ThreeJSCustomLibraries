import {builtinEffects, ramp} from './effects.js';
import {SOUND_BUSES, SOUND_DEFAULTS, SOUND_PRESETS} from './presets.js';

export {SOUND_BUSES, SOUND_DEFAULTS, SOUND_PRESETS};

const clampBlend = value => Math.min(1, Math.max(0, value));

function setVector(target, prefix, vector) {
  for (const axis of ['X', 'Y', 'Z']) target[prefix + axis].value = vector[axis.toLowerCase()];
}

export function createSound({context, destination, buses = SOUND_BUSES, sounds = {}, random = Math.random,
  defaults = {}} = {}) {
  const ownsContext = !context;
  context ??= new AudioContext();
  const settings = {...SOUND_DEFAULTS, ...defaults, panner: {...SOUND_DEFAULTS.panner, ...defaults.panner}};
  const effects = new Map(Object.entries(builtinEffects));
  const mixer = new Map();
  const definitions = new Map(Object.entries(sounds));
  const buffers = new Map();
  const voices = new Set();
  let disposed = false;

  function active() {
    if (disposed) throw new Error('Sound engine is disposed');
  }

  function contains(bus, child) {
    for (let current = child; current; current = current.parent) {
      if (current === bus) return true;
    }
    return false;
  }

  function refreshMix(seconds) {
    const solo = [...mixer.values()].filter(bus => bus.solo);
    for (const bus of mixer.values()) {
      const audible = !bus.mute && (!solo.length || solo.some(selected =>
        contains(selected, bus) || contains(bus, selected)));
      ramp(context, bus.fader.gain, audible ? bus.gain : 0, seconds);
    }
  }

  function addBus(id, {gain = settings.gain, parent = 'master'} = {}) {
    active();
    if (mixer.has(id)) throw new Error('Duplicate sound bus: ' + id);
    const parentBus = mixer.get(parent);
    if (id !== 'master' && !parentBus) throw new Error('Unknown parent bus: ' + parent);
    const input = context.createGain();
    const fader = context.createGain();
    const meter = context.createAnalyser();
    meter.fftSize = settings.meterFrames;
    const samples = new Float32Array(meter.fftSize);
    const chain = [];
    input.connect(fader).connect(meter).connect(id === 'master'
      ? destination ?? context.destination : parentBus.input);
    const bus = {id, input, fader, parent: id === 'master' ? null : parentBus, gain, mute: false, solo: false};
    mixer.set(id, bus);
    refreshMix(0);

    function reconnect() {
      input.disconnect();
      let tail = input;
      for (const effect of chain) {
        effect.output.disconnect();
        tail.connect(effect.input);
        tail = effect.output;
      }
      tail.connect(fader);
    }

    function remove(effect) {
      const index = chain.indexOf(effect);
      if (index === -1) return;
      chain.splice(index, 1);
      effect.input.disconnect();
      if (effect.output !== effect.input) effect.output.disconnect();
      effect.dispose?.();
      reconnect();
    }

    bus.api = {
      setMix({gain = bus.gain, mute = bus.mute, solo = bus.solo} = {}, seconds = settings.fadeSeconds) {
        active();
        Object.assign(bus, {gain, mute, solo: id !== 'master' && solo});
        refreshMix(seconds);
      },
      meter() {
        meter.getFloatTimeDomainData(samples);
        return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
      },
      addEffect(name, options = {}) {
        active();
        const factory = effects.get(name);
        if (!factory) throw new Error('Unknown sound effect: ' + name);
        const effect = factory(context, options);
        chain.push(effect);
        reconnect();
        return {
          set(key, value, seconds = settings.fadeSeconds) {
            active();
            if (!chain.includes(effect)) throw new Error('Sound effect has been removed');
            const param = effect.params?.[key];
            if (!param) throw new Error('Unknown effect parameter: ' + key);
            ramp(context, param, value, seconds);
          },
          remove: () => remove(effect),
        };
      },
    };
    bus.dispose = () => {
      for (const effect of [...chain]) remove(effect);
      for (const node of [input, fader, meter]) node.disconnect();
    };
    return bus.api;
  }

  addBus('master');
  addBus('world');
  for (const id of buses) addBus(id, {parent: id === 'ui' ? 'master' : 'world'});

  function load(url) {
    active();
    if (!buffers.has(url)) {
      const pending = fetch(url).then(response => {
        if (!response.ok) throw new Error('Sound asset failed to load: ' + url);
        return response.arrayBuffer();
      }).then(bytes => context.decodeAudioData(bytes)).catch(error => {
        buffers.delete(url);
        throw error;
      });
      buffers.set(url, pending);
    }
    return buffers.get(url);
  }

  function play(id, options = {}) {
    active();
    if (!definitions.has(id)) throw new Error('Unknown sound: ' + id);
    const {buffer, variants, bus = 'sfx', gain = settings.gain, loop = false, fadeSeconds = 0,
      playbackRate = settings.playbackRate, pitchCents = 0, maxVoices = Infinity, spatial,
      when = context.currentTime} = {...definitions.get(id), ...options};
    const target = mixer.get(bus);
    if (!target) throw new Error('Unknown sound bus: ' + bus);
    const clip = variants?.[Math.floor(random() * variants.length)] ?? buffer;
    if (!clip) throw new Error('Load a buffer before playing sound: ' + id);
    if (maxVoices <= 0) return null;
    const matching = [...voices].filter(voice => voice.id === id && !voice.stopping);
    for (const voice of matching.slice(0, Math.max(0, matching.length + 1 - maxVoices))) voice.api.stop();

    const source = context.createBufferSource();
    const fader = context.createGain();
    const panner = spatial ? context.createPanner() : null;
    source.buffer = clip;
    source.loop = loop;
    source.playbackRate.value = playbackRate;
    source.detune.value = pitchCents ? (random() * 2 - 1) * pitchCents : 0;
    fader.gain.value = fadeSeconds > 0 ? 0 : gain;
    source.connect(fader);
    if (panner) {
      Object.assign(panner, {...settings.panner, ...spatial.panner});
      fader.connect(panner).connect(target.input);
    } else fader.connect(target.input);

    const voice = {id, stopping: false, api: {
      get ended() { return !voices.has(voice); },
      setGain(value, seconds = settings.fadeSeconds) {
        if (voices.has(voice) && !voice.stopping) ramp(context, fader.gain, value, seconds);
      },
      setPose(position, forward) {
        if (!panner || !voices.has(voice)) return;
        setVector(panner, 'position', position);
        if (forward) setVector(panner, 'orientation', forward);
      },
      stop(seconds = 0) {
        if (voice.stopping || !voices.has(voice)) return;
        voice.stopping = true;
        if (seconds > 0) ramp(context, fader.gain, 0, seconds);
        source.stop(context.currentTime + Math.max(0, seconds));
      },
    }};
    voice.dispose = () => {
      voices.delete(voice);
      source.onended = null;
      source.disconnect();
      fader.disconnect();
      panner?.disconnect();
    };
    voices.add(voice);
    source.onended = voice.dispose;
    try {
      if (spatial?.position) voice.api.setPose(spatial.position, spatial.forward);
      source.start(when);
      if (fadeSeconds > 0) {
        const start = Math.max(when, context.currentTime);
        fader.gain.setValueAtTime(0, start);
        fader.gain.linearRampToValueAtTime(gain, start + fadeSeconds);
      }
    } catch (error) {
      voice.dispose();
      throw error;
    }
    return voice.api;
  }

  return {
    context, load, play, addBus,
    async unlock() { active(); await context.resume(); },
    define(id, options) { active(); definitions.set(id, options); },
    bus(id) {
      active();
      if (!mixer.has(id)) throw new Error('Unknown sound bus: ' + id);
      return mixer.get(id).api;
    },
    registerEffect(id, factory) {
      active();
      if (effects.has(id)) throw new Error('Duplicate sound effect: ' + id);
      effects.set(id, factory);
    },
    addEnvironmentFilter({cutoffHz, openCutoffHz, bus = 'world'} = SOUND_PRESETS.underwater) {
      const effect = this.bus(bus).addEffect('filter', {cutoffHz: openCutoffHz});
      return {remove: effect.remove, setBlend(value, seconds) {
        const cutoff = openCutoffHz * (cutoffHz / openCutoffHz) ** clampBlend(value);
        effect.set('cutoffHz', cutoff, seconds);
      }};
    },
    addEnvironmentReverb({impulse, wetGain = SOUND_PRESETS.cave.wetGain, bus = 'world'}) {
      const effect = this.bus(bus).addEffect('reverb', {impulse});
      return {remove: effect.remove, setBlend(value, seconds) {
        effect.set('wetGain', wetGain * clampBlend(value), seconds);
      }};
    },
    setListener(position, forward, up) {
      active();
      setVector(context.listener, 'position', position);
      setVector(context.listener, 'forward', forward);
      setVector(context.listener, 'up', up);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const voice of voices) {
        voice.api.stop();
        voice.dispose();
      }
      for (const bus of mixer.values()) bus.dispose();
      mixer.clear();
      buffers.clear();
      definitions.clear();
      effects.clear();
      if (ownsContext) await context.close();
    },
  };
}

export {createAmbience} from './ambience.js';
