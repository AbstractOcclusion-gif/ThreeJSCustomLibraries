export const RAIN_IMPACT_GLSL = /* glsl */`
// World-space rings. Each cell has its own arrival time and centre.
// Rings fit within their cell and fade when they become subpixel.
vec2 rainImpactGradient(vec2 world, float time, float amount, float footprint) {
 const float cellsPerMeter = 3.1;
 const float cyclesPerSecond = 1.55;
 const float maxRadius = .22;
 const float ringWidth = .035;
 const float arrivalFade = .09;
 const float intensityFade = .13;
 vec2 grid = world * cellsPerMeter;
 vec2 cell = floor(grid);
 float arrival = hash12(cell);
 float clock = time * cyclesPerSecond + arrival;
 float chance = hash12(cell + floor(clock));
 float age = fract(clock);
 vec2 center = mix(vec2(.25), vec2(.75), vec2(arrival, hash12(cell.yx + 19.0)));
 vec2 delta = fract(grid) - center;
 float distance = length(delta);
 float resolution = 1.0 - smoothstep(ringWidth, .18, footprint * cellsPerMeter);
 float ring = (distance - age * maxRadius) / ringWidth;
 float life = smoothstep(0.0, arrivalFade, age) * (1.0 - smoothstep(.35, 1.0, age));
 float envelope = life * exp(-ring * ring) * resolution;
 return delta / max(distance, .001) * sin(ring * 2.0) * envelope * smoothstep(0.0, intensityFade, amount - chance);
}
`;
