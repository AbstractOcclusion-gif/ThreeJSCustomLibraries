import {SOUND_DEFAULTS} from './presets.js';

export function createAmbience(sound, {layers = [], cues = [], fadeSeconds = SOUND_DEFAULTS.fadeSeconds,
  random = Math.random} = {}) {
  const loops = new Map();
  const oneShots = new Set();
  const next = new Map();
  const levels = new Map();
  let running = false;

  function schedule(cue, time) {
    const [min, max] = cue.intervalSeconds;
    next.set(cue, time + min + (max - min) * random());
  }

  return {
    start() {
      if (running) return;
      running = true;
      try {
        for (const layer of layers) {
          const gain = levels.get(layer.id) ?? layer.gain;
          const voice = sound.play(layer.sound, {loop: true, fadeSeconds, ...(gain === undefined ? {} : {gain})});
          if (voice) loops.set(layer.id, voice);
        }
        for (const cue of cues) schedule(cue, sound.context.currentTime);
      } catch (error) {
        this.stop(0);
        throw error;
      }
    },
    setLevel(id, gain, seconds = fadeSeconds) {
      levels.set(id, gain);
      loops.get(id)?.setGain(gain, seconds);
    },
    update() {
      if (!running || sound.context.state !== 'running') return;
      const now = sound.context.currentTime;
      for (const voice of oneShots) if (voice.ended) oneShots.delete(voice);
      for (const cue of cues) {
        if (now < next.get(cue)) continue;
        schedule(cue, now);
        const voice = sound.play(cue.sound, cue.options);
        if (voice) oneShots.add(voice);
      }
    },
    stop(seconds = fadeSeconds) {
      running = false;
      for (const voice of [...loops.values(), ...oneShots]) voice.stop(seconds);
      loops.clear();
      oneShots.clear();
      next.clear();
    },
  };
}
