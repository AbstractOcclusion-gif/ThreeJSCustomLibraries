// ocean/jerlov.js -- port of WebGpuWater's JerlovWaterTypes.cs: per-channel extinction (1/m, red dies first) and the body
// colour (an inspector colour, i.e. sRGB) of the physical Jerlov water types. One preset drives the surface's scatter colour AND the underwater fog so the dive is
// seamless (the same water above and below the line).
export const JERLOV = Object.freeze({
  'Open ocean I': { extinction: [0.6189, 0.0582, 0.0331], body: [0.0000, 0.0323, 0.1223] },
  'Open ocean IA': { extinction: [0.6189, 0.0587, 0.0373], body: [0.0000, 0.0348, 0.1144] },
  'Open ocean IB': { extinction: [0.6189, 0.0584, 0.0384], body: [0.0000, 0.0721, 0.1741] },
  'Open ocean II': { extinction: [0.6189, 0.0583, 0.0380], body: [0.0000, 0.2805, 0.5495] },
  'Open ocean III': { extinction: [0.7124, 0.0612, 0.0514], body: [0.0335, 0.5801, 0.8500] },
  'Coastal 1C': { extinction: [0.8125, 0.0667, 0.1043], body: [0.0132, 0.2439, 0.2391] },
  'Coastal 3C': { extinction: [0.6587, 0.0712, 0.1508], body: [0.0775, 0.5448, 0.4060] },
  'Coastal 5C': { extinction: [0.3035, 0.0849, 0.2280], body: [0.1295, 0.5584, 0.3404] },
  'Coastal 7C': { extinction: [0.2790, 0.1154, 0.3611], body: [0.2564, 0.6742, 0.3732] },
  'Coastal 9C': { extinction: [0.2865, 0.1779, 0.6630], body: [0.3349, 0.6065, 0.2968] },
  'Legacy (classic look)': { extinction: [0.9000, 0.3000, 0.1600], body: [0.0250, 0.3000, 0.5000] },
});
export const JERLOV_NAMES = Object.keys(JERLOV);
