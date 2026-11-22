// Integrate a short chord through a rounded puff. Reorient the chord in world axes so
// turning the camera does not turn the density field. No sprite image supplies density.
export const PUFF_VOLUME_GLSL = /* glsl */`
  uniform highp sampler3D puffNoise;
  uniform vec3 puffSun;
  uniform vec3 puffRollAxis;
  uniform float puffVolume, puffAge, puffSeed;

  vec4 puffVolumeColor(vec2 uv) {
    vec2 xy = uv * 2.0 - 1.0;
    float chord = sqrt(max(0.0, 1.0 - dot(xy, xy)));
    if (chord <= 0.0) return vec4(0.0);
    mat3 toWorld = transpose(mat3(viewMatrix));
    vec3 offset = vec3(puffSeed, -puffAge * .05, puffSeed * .33);
    float density = 0.0;
    for (int i = 0; i < 4; i++) {
      vec3 q = vec3(xy, chord * (.75 - float(i) * .5));
      vec3 p = toWorld * q;
      // Rotate the lookup opposite the visible flow: the upper outside rolls down.
      // The azimuthal axis changes sign on opposite sides of the plume.
      float angle = puffAge * .65;
      float strength = length(puffRollAxis);
      vec3 axis = puffRollAxis / max(strength, .0001);
      vec3 rolled = p * cos(angle) + cross(axis, p) * sin(angle)
        + axis * dot(axis, p) * (1.0 - cos(angle));
      p = mix(p, rolled, min(1.0, strength));
      vec3 coord = p * .46 + offset;
      float coarse = texture(puffNoise, coord).r;
      float detail = texture(puffNoise, coord * 2.15 + .32).r;
      float body = 1.0 - length(q);
      density += smoothstep(.02, .44, body + (coarse - .53) * .85 + (detail - .5) * .24);
    }
    float edge = smoothstep(0.0, .68, chord);
    float alpha = (1.0 - exp(-density * chord * .7)) * edge;
    vec3 face = toWorld * normalize(vec3(xy, chord));
    float facing = dot(face, puffSun);
    float grain = texture(puffNoise, face * .46 + offset).r;
    float light = mix(.43, 1.85, smoothstep(-.3, .68, facing + (grain - .5) * 1.12));
    // Keep the thin perimeter close to the common cloud tint so overlapping
    // parcels do not draw a dark rim around each individual billow.
    light = mix(1.0, light, smoothstep(.12, .82, chord));
    return vec4(vec3(light), alpha);
  }
`;
