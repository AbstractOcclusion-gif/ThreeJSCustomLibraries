// Shared presentation envelope: strong outward overturn at ignition, then a
// gentle residual roll. Integrate angular speed so easing never reverses phase.
export const ROLL_MOTION = Object.freeze({initial:2.5,late:.24,decay:12});
export function puffRollRate(age,motion=ROLL_MOTION) {
  return motion.late+(motion.initial-motion.late)*Math.exp(-Math.max(0,age)/motion.decay);
}
export function puffRollPhase(age,motion=ROLL_MOTION) {
  const t=Math.max(0,age),r=motion;
  return .65*(r.late*t+(r.initial-r.late)*r.decay*(-Math.expm1(-t/r.decay)));
}
export const PUFF_ROLL_GLSL = `
  float blastRollPhase(float age) {
    float t=max(0.,age);
    return .65*(${ROLL_MOTION.late}*t+${ROLL_MOTION.initial-ROLL_MOTION.late}*${ROLL_MOTION.decay}.0*(1.-exp(-t/${ROLL_MOTION.decay}.0)));
  }
`;

export function skirtHeightShare(radiusShare) {
  const t = Math.max(0, Math.min(1, (radiusShare - .35) / .7));
  const edge = t * t * (3 - 2 * t);
  return .94 - edge * .34;
}

// Coherent lateral motion shared by the volume and its detail parcels. The ground
// stays anchored and the upper head shares one slow drift instead of deforming.
export function plumeOffset(height, time, headHeight = 78) {
  const h = Math.min(1, Math.max(0, height / 78));
  const bend = h * h * (3 - 2 * h);
  const drift = Math.max(0, time - 1.2);
  const stem=Math.max(0,Math.min(1,height/Math.max(14,headHeight)/.55));
  const envelope=Math.sin(Math.PI*stem)**2;
  const strength=1.6*envelope*(1-Math.exp(-Math.max(0,time-3)/4));
  return [
    bend * (Math.min(drift, 36) * .12 + 1.2 * Math.sin(time * .31) + .5 * Math.sin(height * .082 + time * .62)) + strength*Math.sin(stem*7-time*.45),
    bend * (Math.min(drift, 36) * .05 + .9 * Math.sin(time * .24) + .4 * Math.sin(height * .069 - time * .47)) + strength*.65*Math.sin(stem*6+time*.37),
  ];
}

export const PLUME_MOTION_GLSL = /* glsl */`
  vec2 plumeOffset(float height,float time,float headHeight) {
    float h=clamp(height/78.,0.,1.);
    float bend=h*h*(3.-2.*h);
    float drift=max(0.,time-1.2);
    float stem=clamp(height/max(14.,headHeight)/.55,0.,1.);
    float envelope=pow(sin(3.14159265359*stem),2.);
    float strength=1.6*envelope*(1.-exp(-max(0.,time-3.)/4.));
    return bend*vec2(
      min(drift,36.)*.12+1.2*sin(time*.31)+.5*sin(height*.082+time*.62),
      min(drift,36.)*.05+.9*sin(time*.24)+.4*sin(height*.069-time*.47)
    )+strength*vec2(sin(stem*7.-time*.45),.65*sin(stem*6.+time*.37));
  }
`;
