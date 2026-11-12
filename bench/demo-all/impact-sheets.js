import {seededRandom} from '../../src/core/hash.js';

const ATLAS = {cols: 4, rows: 4, tile: 96, seed: 4351};
const CROWN = {jets: 32, width: .37, spread: .56, base: .41, height: .92, drop: .045};
const FOAM = {flecks: 72, startRadius: .24, spread: .61, maxFleck: .13};

function makeSheet(draw) {
  const {cols, rows, tile} = ATLAS;
  const canvas = document.createElement('canvas');
  canvas.width = cols * tile;
  canvas.height = rows * tile;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const frames = cols * rows;
  for (let frame = 0; frame < frames; frame++) {
    ctx.save();
    ctx.translate((frame % cols) * tile, Math.floor(frame / cols) * tile);
    ctx.beginPath();
    ctx.rect(0, 0, tile, tile);
    ctx.clip();
    ctx.translate(tile / 2, tile / 2);
    ctx.scale(tile / 2, tile / 2);
    draw(ctx, frame / (frames - 1));
    ctx.restore();
  }
  return {url: canvas.toDataURL(), cols, rows};
}

export function createImpactSheets() {
  const random = seededRandom(ATLAS.seed);
  const samples = count => Array.from({length: count}, () => ({
    angle: random() * Math.PI * 2, weight: random(), size: random(),
  }));
  const jets = samples(CROWN.jets), flecks = samples(FOAM.flecks);
  return {
    crown: makeSheet((ctx, age) => {
      const fade = Math.sin(Math.PI * age) * (1 - age);
      const growth = Math.sqrt(age);
      for (const {angle, weight, size} of jets) {
        const side = Math.cos(angle), depth = Math.sin(angle);
        const rootX = side * CROWN.width * growth;
        const rootY = CROWN.base + depth * CROWN.drop;
        const tipX = rootX + side * CROWN.spread * age;
        const tipY = rootY - CROWN.height * growth * (1 - age) * (1 + weight);
        ctx.strokeStyle = ctx.fillStyle = 'white';
        ctx.globalAlpha = fade * (.4 + weight * .6);
        ctx.lineWidth = CROWN.drop * (.25 + size);
        ctx.beginPath();
        ctx.moveTo(rootX, rootY);
        ctx.quadraticCurveTo(rootX, tipY, tipX, tipY);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(tipX, tipY, CROWN.drop * size, CROWN.drop * (.5 + size), angle, 0, Math.PI * 2);
        ctx.fill();
      }
    }),
    foam: makeSheet((ctx, age) => {
      const radius = FOAM.startRadius + age * FOAM.spread;
      for (const {angle, weight, size} of flecks) {
        const distance = radius * Math.sqrt(weight);
        ctx.fillStyle = 'white';
        ctx.globalAlpha = (1 - age) * (.18 + size * .72);
        ctx.beginPath();
        ctx.ellipse(Math.cos(angle) * distance, Math.sin(angle) * distance,
          size * FOAM.maxFleck, (1 - size) * FOAM.maxFleck, angle, 0, Math.PI * 2);
        ctx.fill();
      }
    }),
  };
}
