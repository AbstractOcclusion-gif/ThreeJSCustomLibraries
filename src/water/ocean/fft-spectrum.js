// ocean/fft-spectrum.js -- port of WebGpuWater's WaterOceanSpectrum.cs: the JONSWAP/TMA sea-state shape, the disjoint cascade
// band layout derived from the peak wavelength, and the CPU gains that make the FFT field's Hs match the authored metres.
// The GPU twin of jonswapOmni / swellShape lives in fft.js (SPECTRUM_INIT_GLSL) and must stay identical.
export const GRAVITY = 9.81, TWO_PI = Math.PI * 2;
export const JONSWAP_PEAK_DECAY = 1.25, JONSWAP_SIGMA_LOW = 0.07, JONSWAP_SIGMA_HIGH = 0.09;   // the 5/4 and the peak-enhancement widths
export const TMA_SLOPE = 1.8, TMA_OFFSET = 1.125;                                              // shallow-water (TMA) factor
export const SWELL_WIDTH = 0.12, SWELL_DIR_POWER = 6;                                          // swell ring: relative k width, directional tightness
const TOP_BAND_PEAK_MULTIPLE = 2;              // longest wave the coarsest cascade carries, as a multiple of the peak wavelength
const CASCADE_BAND_RATIO = 0.2360679775;       // each finer cascade's band top = this x the next coarser one
const VISIBLE_AREA_BAND_MULTIPLE = 8;          // per-cascade view distance = band top x this x cascadeReach
export const CASCADE_TILE_OVERSAMPLE = 4;      // WaterOceanFft.CascadeTileOversample: the FFT tile is 4x the longest wave it carries
const MIN_WAVELENGTH = 1e-3, MIN_ANGULAR_FREQ = 1e-6, MIN_VARIANCE = 1e-12;
const SIGNIFICANT_HEIGHT_TO_RMS = 4;           // Hs = 4 sqrt(m0)
const REAL_PART_VARIANCE_SHARE = 0.5;

export const peakAngularFrequency = peakWavelength => Math.sqrt(GRAVITY * (TWO_PI / Math.max(peakWavelength, MIN_WAVELENGTH)));

export function deriveCascadeBands(peakWavelength, cascades) {
  const bands = new Array(cascades);
  let top = Math.max(peakWavelength, MIN_WAVELENGTH) * TOP_BAND_PEAK_MULTIPLE;
  for (let i = cascades - 1; i >= 0; i--) { bands[i] = top; top *= CASCADE_BAND_RATIO; }
  return bands;
}

// JONSWAP/TMA density as a 2D density in k. GPU twin: oceanJonswapOmni.
export function jonswapOmni(waveNumber, peakAngularFreq, peakSharpness, seaDepth) {
  if (waveNumber < MIN_ANGULAR_FREQ) return 0;
  const omega = Math.sqrt(GRAVITY * waveNumber), peakRatio = peakAngularFreq / omega, peakRatio2 = peakRatio * peakRatio;
  let shape = Math.exp(-JONSWAP_PEAK_DECAY * peakRatio2 * peakRatio2) / Math.pow(omega, 5);
  const sigma = omega <= peakAngularFreq ? JONSWAP_SIGMA_LOW : JONSWAP_SIGMA_HIGH;
  const peakOffset = (omega - peakAngularFreq) / Math.max(sigma * peakAngularFreq, MIN_ANGULAR_FREQ);
  shape *= Math.pow(Math.max(peakSharpness, 1), Math.exp(-0.5 * peakOffset * peakOffset));
  if (seaDepth > 0) shape *= 0.5 + 0.5 * Math.tanh(TMA_SLOPE * (omega * Math.sqrt(seaDepth / GRAVITY) - TMA_OFFSET));
  const dOmegaDk = 0.5 * Math.sqrt(GRAVITY / waveNumber);
  return shape * dOmegaDk / waveNumber;
}

export function swellShape(kx, ky, waveNumber, swellWavelength, dirX, dirY) {
  if (waveNumber < MIN_ANGULAR_FREQ) return 0;
  const kSwell = TWO_PI / Math.max(swellWavelength, MIN_WAVELENGTH), width = kSwell * SWELL_WIDTH, offset = waveNumber - kSwell;
  const radial = Math.exp(-(offset * offset) / (2 * width * width));
  const alignment = Math.min(Math.max((kx * dirX + ky * dirY) / waveNumber, 0), 1);
  return radial * Math.pow(alignment, SWELL_DIR_POWER);
}

// Cascade layout: domain sizes (tile metres), disjoint bands and visible areas, all from the two authored knobs.
export function buildLayout(resolution, cascades, peakWavelength, cascadeReach) {
  const bandMax = [1, 1, 1, 1], bandMin = [0, 0, 0, 0], domainSizes = [1, 1, 1, 1], visibleAreas = [1, 1, 1, 1];
  const bands = deriveCascadeBands(peakWavelength, cascades);
  for (let i = 0; i < cascades; i++) bandMax[i] = bands[i];
  for (let i = 1; i < cascades; i++) bandMin[i] = bandMax[i - 1];
  for (let i = 0; i < 4; i++) { domainSizes[i] = bandMax[i] * CASCADE_TILE_OVERSAMPLE; visibleAreas[i] = bandMax[i] * VISIBLE_AREA_BAND_MULTIPLE * Math.max(cascadeReach, 0); }
  return { resolution, cascades, bandMax, bandMin, domainSizes, visibleAreas };
}

// Short-wave roll-off: 0 below shortestWavelength, 1 above twice it (smoothstep), so the JONSWAP tail can be
// trimmed without ringing. GPU twin: oceanShortWaveWeight. 0 disables.
export const SHORT_WAVE_ROLLOFF_SPAN = 2;
export function shortWaveWeight(wavelength, shortestWavelength) {
  if (!(shortestWavelength > 0)) return 1;
  const t = Math.min(Math.max((wavelength - shortestWavelength) / (shortestWavelength * (SHORT_WAVE_ROLLOFF_SPAN - 1)), 0), 1);
  return t * t * (3 - 2 * t);
}

// Unit-gain variance of the wind sea and of the swell ring over the kept bands (resolution^2 x cascades loop: call on
// SHAPE change only -- heights rescale the gains linearly through gainForHeight below).
export function computeUnitVariances(layout, peakAngularFreq, peakSharpness, seaDepth, swellWavelength, shortestWavelength = 0) {
  let windSeaVariance = 0, swellVariance = 0;
  const half = layout.resolution * 0.5;
  for (let slice = 0; slice < layout.cascades; slice++) {
    const dk = TWO_PI / Math.max(layout.domainSizes[slice], MIN_WAVELENGTH), measure = dk * dk;
    const bandMin = layout.bandMin[slice], bandMax = layout.bandMax[slice];
    for (let y = 0; y < layout.resolution; y++) for (let x = 0; x < layout.resolution; x++) {
      const kx = (x - half) * dk, ky = (y - half) * dk, waveNumber = Math.hypot(kx, ky);
      if (waveNumber < MIN_ANGULAR_FREQ) continue;
      const wavelength = TWO_PI / waveNumber;
      if (wavelength <= bandMin || wavelength > bandMax) continue;
      windSeaVariance += measure * jonswapOmni(waveNumber, peakAngularFreq, peakSharpness, seaDepth) * shortWaveWeight(wavelength, shortestWavelength);
      // swell reference direction (1, 0): the ring's variance is rotation-invariant
      swellVariance += measure * (swellShape(kx, ky, waveNumber, swellWavelength, 1, 0) + swellShape(-kx, -ky, waveNumber, swellWavelength, 1, 0));
    }
  }
  return { windSeaVariance, swellVariance };
}

export function gainForHeight(significantHeight, unitVariance) {
  if (significantHeight <= 0 || unitVariance < MIN_VARIANCE) return 0;
  const targetRms = significantHeight / SIGNIFICANT_HEIGHT_TO_RMS;
  return targetRms * targetRms / (unitVariance * REAL_PART_VARIANCE_SHARE);
}
