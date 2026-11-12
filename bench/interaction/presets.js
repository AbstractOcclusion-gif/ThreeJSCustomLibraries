export const DEMO = {
  camera: {fov: 48, near: 0.1, far: 80, position: [0, 9, 13], target: [0, 1, 0]},
  background: '#182934',
  grid: {size: 24, divisions: 24},
  maxDistance: 24,
  useKey: 'KeyE',
  sequence: ['amber', 'blue', 'green'],
  levers: [
    {id: 'blue', label: 'Blue', color: '#76b9ff', position: [-7, 0.6, 2]},
    {id: 'amber', label: 'Amber', color: '#ffbd63', position: [-5, 0.6, 2]},
    {id: 'green', label: 'Green', color: '#8be1a6', position: [-3, 0.6, 2]},
  ],
  lever: {size: [1, 1.2, 1], activatedAngle: 0.35},
  gate: {size: [4, 2.5, 0.5], color: '#7495a5', sequenceX: -5, weightX: 5, z: -2, lift: 3, speed: 4},
  latch: {size: [1, 1.2, 1], color: '#d9b8ef', position: [-5, 0.6, -0.5], holdSeconds: 1.2},
  screen: {size: [1.5, 2, 0.4], color: '#46515d', position: [-5, 1, 1]},
  plate: {size: [4, 0.25, 2], color: '#586970', position: [5, 0.125, 0]},
  weights: {
    massesKg: [2, 3, 4], requiredKg: 6, settleSeconds: 0.8,
    size: [1, 1, 1], color: '#dbc89b', firstX: 3.6, spacing: 1.4, shelfZ: 3, plateZ: 0,
  },
};
