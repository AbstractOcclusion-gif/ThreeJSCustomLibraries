// Raindrop rings on standing water, in world space. Needs NOISE_GLSL (hash12, hash13) before it.
export const RAIN_IMPACT_GLSL = /* glsl */`
// One layer of drops on a grid of cells. Every cycle each cell may receive one drop at a new random spot: a short
// train of rings spreads from it and dies before it reaches the cell edge.
// Returns xy = slope of the water surface along world X and Z, z = the brief splash at the point of impact (0..1).
vec3 rainImpactLayer(vec2 world, float time, float amount, float footprint, float cellMeters, float cyclesPerSecond, vec2 offset) {
 const float reach = .36;             // largest ring radius, as a share of the cell: also the margin kept around a drop
 const float wavelength = .075;       // ring spacing, as a share of the cell
 const float trainRings = 1.5;        // rings carried behind the leading one
 const float arrivalShare = .04;      // share of the cycle over which a new drop fades in
 const float splashShare = .14;       // share of the cycle the splash lasts
 const float splashRadius = .05;      // share of the cell
 const float intensityFade = .1;      // rain amount over which a cell's drop fades in
 const float tau = 6.2831853;
 vec2 grid = world / cellMeters + offset;
 vec2 cell = floor(grid);
 float clock = time * cyclesPerSecond + hash12(cell);
 float cycle = floor(clock), age = fract(clock);
 float falls = smoothstep(0.0, intensityFade, amount - hash13(vec3(cell, cycle)));
 vec2 centre = mix(vec2(reach), vec2(1.0 - reach), vec2(hash13(vec3(cell, cycle + 11.0)), hash13(vec3(cell.yx, cycle + 29.0))));
 vec2 delta = fract(grid) - centre;
 float distance = length(delta);
 float rings = (distance - age * reach) / wavelength;   // 0 on the leading ring, negative behind it
 float train = exp(-pow((rings + trainRings * .5) / trainRings, 2.0));
 float life = smoothstep(0.0, arrivalShare, age) * (1.0 - age) * (1.0 - age);
 // A ring fades out before a pixel spans it, or distant puddles would shimmer.
 float resolved = 1.0 - smoothstep(.3, .75, footprint / (wavelength * cellMeters));
 float slope = cos(rings * tau) * train * life * resolved * falls;
 float splash = falls * (1.0 - smoothstep(0.0, splashShare, age)) * (1.0 - smoothstep(splashRadius * .5, splashRadius, distance));
 return vec3(delta / max(distance, .0001) * slope, splash);
}

// Three layers of different cell size and rhythm, so rings overlap and no beat or grid shows.
// size scales the rings, rate how often drops fall. Returns xy = surface slope, z = splash.
vec3 rainImpacts(vec2 world, float time, float amount, float footprint, float size, float rate) {
 const vec3 cellMeters = vec3(.3, .42, .56);
 const vec3 cyclesPerSecond = vec3(1.9, 1.45, 1.1);
 return rainImpactLayer(world, time, amount, footprint, cellMeters.x * size, cyclesPerSecond.x * rate, vec2(0.0))
  + rainImpactLayer(world, time, amount, footprint, cellMeters.y * size, cyclesPerSecond.y * rate, vec2(.37, .71))
  + rainImpactLayer(world, time, amount, footprint, cellMeters.z * size, cyclesPerSecond.z * rate, vec2(.83, .19));
}
`;
