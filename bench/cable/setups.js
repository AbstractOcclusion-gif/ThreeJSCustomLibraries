const fixed = position => ({kind: 'fixed', position});
const driven = position => ({kind: 'driven', position});
const load = (name, localPoint) => ({kind: 'body', name, localPoint});
const rope = (a, b, options = {}) => ({endpoints: [a, b], ...options});

const overheadY = 5;
const stool = {
  name: 'stool', mass: 6, position: [0, 1.25, 0], color: 0xbd8054,
  boxes: [
    {size: [1.35, .2, 1.05], offset: [0, .2, 0]},
    ...[-.5, .5].flatMap(x => [-.36, .36].map(z => ({size: [.16, .76, .16], offset: [x, -.28, z]}))),
  ],
};
const seat = {
  name: 'seat', mass: 8, position: [0, 1.4, 0], color: 0xc38755,
  boxes: [{size: [2.2, .25, .85], offset: [0, 0, 0]}],
};
const gate = {
  name: 'gate', mass: 2, position: [0, 1, 0], color: 0x799daa, fixedRotation: true,
  boxes: [{size: [2.1, 1.5, .3], offset: [0, 0, 0]}],
};

export const BENCH_DEFAULTS = {
  setup: 'Fixed span', preset: 'rope', span: 8, slack: 1.1, breakStrength: 1e6, segments: 16,
  pull: 0,
};
export const BENCH_WORLD = {
  gravity: -9.82, solverIterations: 32, groundSize: 20,
  strokePerSecond: .65, postSides: 24,
  cameraPosition: [7, 5, 13], cameraTarget: [0, 2.4, 0], fov: 42, near: .1, far: 100,
  background: 0x213343, skyLight: 0xffffff, groundLight: 0x6e7c8a, lightIntensity: 2.5,
  gridCenter: 0x7992a8, gridLine: 0x42576a, gridDivisions: 20,
  anchorColor: 0x66d6e5, anchorRadius: .13,
};
export const BENCH_SNOW = {
  count: 360, seed: 913, width: 18, height: 9, fallSpeed: 1.15, size: .06, windDrift: .32,
  color: 0xe9f4ff,
};

export const SETUPS = {
  'Fixed span': {
    description: 'Cut the rope or release its first anchor.',
    ropes: ({span}) => [rope(fixed([-span / 2, 3, 0]), fixed([span / 2, 3, 0]))],
  },
  'Stool twist': {
    description: 'Spin the suspended stool and watch it turn on the rope. Release its attachment to drop it.',
    bodies: [stool],
    ropes: () => [rope(fixed([0, overheadY, 0]), load('stool', [0, .3, 0]))],
    action: {label: 'Twist stool', body: 'stool', angularVelocity: [0, 4, 0]},
    releaseEnd: 1,
  },
  'Crossing ropes': {
    description: 'Sweep the driven rope across the other rope and watch their contact.',
    ropes: () => [
      rope(fixed([-3, 3.4, 0]), fixed([3, 3.4, 0])),
      rope(driven([0, 4.2, -3]), driven([0, 4.2, 3]), {slack: 1.04}),
    ],
    drive: {label: 'Lower crossing rope', cable: 1, ends: [0, 1], offset: [0, -1.5, 0]},
  },
  'Rope against objects': {
    description: 'Draw the rope against the round post. Push the loose stool into the span to try a moving obstacle.',
    bodies: [{name: 'post', position: [0, 1.55, .2], color: 0x8d9eaa, radius: .72, height: 3.1}, {
      ...stool, position: [-1.9, .65, -2.35],
    }],
    ropes: () => [rope(fixed([-3, 2.5, -1.2]), driven([3, 2.5, -1.2]))],
    drive: {label: 'Draw around post', cable: 0, ends: [1], offset: [0, 0, 2.8]},
    action: {label: 'Push stool', body: 'stool', impulse: [0, 26, 14]},
  },
  'Swing': {
    description: 'Push the seat, then release one rope at the seat and watch the load transfer.',
    bodies: [seat],
    ropes: () => [-.85, .85].map(x => rope(fixed([x, overheadY, 0]), load('seat', [x, .125, 0]), {slack: 1.03})),
    action: {label: 'Push swing', body: 'seat', impulse: [0, 0, 18]},
    releaseEnd: 1,
  },
  'Pull-rope gate': {
    description: 'Raise the handle to take up slack and lift the gate above the marked height.',
    bodies: [gate],
    ropes: () => [rope(driven([0, 4.2, 0]), load('gate', [0, .75, 0]), {slack: 1.03})],
    drive: {label: 'Pull handle', cable: 0, ends: [0], offset: [0, 2, 0]},
    gate: {body: 'gate', clearHeight: 2.25, markerSize: [2.7, .04, .12], markerZ: -.3, color: 0x84e6b2},
  },
};

export const ENVIRONMENT_DEFAULTS = {environment: false, windSpeed: 10, windHeading: 90, gust: .5, snow: 0};
