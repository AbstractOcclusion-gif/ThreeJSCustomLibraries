import {Vector4} from 'three';

export const waveCount = 8;

// Reduced WebAquarium wind-wave bank: JONSWAP weights, gravity dispersion,
// logarithmic wavelength bands and significant-height normalization.
export function createWaveBank() {
 const carriers = Array.from({length: waveCount}, () => new Vector4());
 const amplitudes = Array.from({length: waveCount}, () => new Vector4());
 let key;
 function update(height, wavelength, direction, spread) {
  const next = [height, wavelength, direction, spread].join('/');
  if (key === next) return;
  key = next;
  const peak = Math.sqrt(9.81 * 2 * Math.PI / wavelength);
  let variance = 0;
  for (let i = 0; i < waveCount; i++) {
   const k = 2 * Math.PI / (wavelength * .5 * 5 ** ((i + .5) / waveCount));
   const omega = Math.sqrt(9.81 * k);
   const angle = ((i + 1) * .6180339887 % 1 * 2 - 1) * spread;
   const heading = direction + angle;
   const sigma = omega < peak ? .07 : .09;
   const peakWeight = Math.exp(-.5 * ((omega / peak - 1) / sigma) ** 2);
   const ratio = peak / omega;
   const amplitude = Math.sqrt(ratio ** 5 * Math.exp(-1.25 * ratio ** 4) * 3.3 ** peakWeight);
   carriers[i].set(Math.cos(heading), Math.sin(heading), k, omega);
   amplitudes[i].set(amplitude, (i * i * 1.739) % (2 * Math.PI), 0, 0);
   variance += amplitude ** 2;
  }
  for (const wave of amplitudes) wave.x *= height / Math.sqrt(8 * variance);
 }
 return {carriers, amplitudes, update};
}
