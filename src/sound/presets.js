export const SOUND_DEFAULTS = Object.freeze({
  gain: 1,
  playbackRate: 1,
  fadeSeconds: 0.2,
  meterFrames: 256,
  panner: Object.freeze({
    panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1,
    maxDistance: 100, rolloffFactor: 1, coneInnerAngle: 360,
    coneOuterAngle: 360, coneOuterGain: 0,
  }),
});

export const SOUND_BUSES = Object.freeze(['music', 'ambience', 'sfx', 'ui']);
export const SOUND_PRESETS = Object.freeze({
  underwater: Object.freeze({cutoffHz: 520, openCutoffHz: 20000}),
  cave: Object.freeze({wetGain: 0.35}),
});
