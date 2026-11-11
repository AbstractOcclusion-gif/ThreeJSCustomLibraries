export const RAIN_IMPACT_GLSL = /* glsl */`
// World-space rings. Each cell has its own arrival time and centre.
// Rings fit within their cell and fade when they become subpixel.
vec2 rainImpactGradient(vec2 world, float time, float amount, float footprint) {
 const float cellsPerMeter = 3.1;
 const float cyclesPerSecond = 1.55;
 const float maxRadius = .18;
 const float ringWidth = .026;
 const float arrivalFade = .2;
 const float decayStart = .32;
 const float arcFrequency = 1.7;
 const float arcFloor = .24;
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
 vec2 radial = delta / max(distance, .001);
 // Keep the breakup fixed as the ring expands. Only portions of the
 // circumference catch the light, rather than the whole circle at once.
 float arc = valueNoise(vec3(cell + radial * arcFrequency, 4.0));
 float arcWeight = mix(arcFloor, 1.0, smoothstep(.32, .72, arc));
 float resolution = 1.0 - smoothstep(ringWidth, .18, footprint * cellsPerMeter);
 float ring = (distance - age * maxRadius) / ringWidth;
 float life = smoothstep(0.0, arrivalFade, age) * (1.0 - smoothstep(decayStart, 1.0, age));
 float envelope = life * exp(-ring * ring) * resolution;
 return radial * sin(ring * 2.0) * envelope * arcWeight * smoothstep(0.0, intensityFade, amount - chance);
}
`;
