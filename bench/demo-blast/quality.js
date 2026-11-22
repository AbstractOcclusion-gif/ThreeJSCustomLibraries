export const BLAST_QUALITY = Object.freeze({
  low: Object.freeze({
    label: 'Low', pixelRatio: .65, raySteps: 24, puffScale: .6, puffPool: 210,
    fluid: {columns: 24, rows: 44, cell: 5, pressureIterations: 24},
    bloom: 0, shafts: false, fog: false, skyCapture: 1.5,
  }),
  balanced: Object.freeze({
    label: 'Balanced', pixelRatio: .75, raySteps: 32, puffScale: .65, puffPool: 230,
    fluid: {columns: 30, rows: 54, cell: 4, pressureIterations: 28},
    bloom: .18, shafts: false, fog: true, skyCapture: 1,
  }),
  high: Object.freeze({
    label: 'High', pixelRatio: 1, raySteps: 64, puffScale: 1, puffPool: 320,
    fluid: {columns: 40, rows: 72, cell: 3, pressureIterations: 65},
    bloom: .25, shafts: true, fog: true, skyCapture: .35,
  }),
});

export function resolveBlastQuality(name) {
  return Object.hasOwn(BLAST_QUALITY, name) ? name : 'balanced';
}
