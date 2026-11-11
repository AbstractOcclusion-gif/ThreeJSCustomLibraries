export const DEMO = {
  initial: {listener: 0, underwater: 0, cave: 0, rain: 0, wind: 0.35},
  range: {min: 0, max: 1, step: 0.01},
  listenerRange: {min: -8, max: 8, step: 0.1},
  mix: {master: 0.65, world: 1, music: 0.25, ambience: 0.55, sfx: 0.6, ui: 0.6},
  customFilterHz: 1100,
  customFilterQ: 4,
  cueIntervalSeconds: [4, 9],
  scene: {
    background: '#294351', gridSize: 32, gridDivisions: 32, cameraFov: 48, near: 0.1, far: 100,
    view: [0, 16, 17], listenerZ: 5, orbitRadius: 6, orbitRadiansPerSecond: 0.6,
    markerRadius: 0.45, markerSegments: 16, emitterColor: '#ffc46c', listenerColor: '#96e8ef',
  },
  clips: {
    emitter: {seconds: 2, hz: 180, gain: 0.35},
    music: {seconds: 4, hz: 110, gain: 0.12},
    click: {seconds: 0.12, hz: 760, gain: 0.7, decay: 8},
    cue: {seconds: 0.4, hz: 470, gain: 0.25, decay: 5},
    rain: {seconds: 3, gain: 0.35, smoothing: 0.1},
    wind: {seconds: 3, gain: 0.85, smoothing: 0.98},
    impulse: {seconds: 1.4, gain: 0.4, smoothing: 0.25, decay: 6},
  },
};
