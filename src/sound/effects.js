export function ramp(context, param, value, seconds) {
  const now = context.currentTime;
  if (seconds <= 0) {
    param.cancelScheduledValues(now);
    param.setValueAtTime(value, now);
    return;
  }
  if (param.cancelAndHoldAtTime) {
    param.cancelAndHoldAtTime(now);
    param.linearRampToValueAtTime(value, now + seconds);
  } else {
    const current = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
    param.linearRampToValueAtTime(value, now + seconds);
  }
}

export const builtinEffects = {
  filter(context, {type = 'lowpass', cutoffHz, q, gainDb}) {
    const node = context.createBiquadFilter();
    node.type = type;
    if (cutoffHz !== undefined) node.frequency.value = cutoffHz;
    if (q !== undefined) node.Q.value = q;
    if (gainDb !== undefined) node.gain.value = gainDb;
    return {input: node, output: node, params: {cutoffHz: node.frequency, q: node.Q, gainDb: node.gain}};
  },
  compressor(context, options) {
    const node = context.createDynamicsCompressor();
    const params = {thresholdDb: node.threshold, kneeDb: node.knee, ratio: node.ratio,
      attackSeconds: node.attack, releaseSeconds: node.release};
    for (const [key, value] of Object.entries(options)) params[key].value = value;
    return {input: node, output: node, params};
  },
  delay(context, {delaySeconds, maxDelaySeconds}) {
    const node = context.createDelay(maxDelaySeconds);
    if (delaySeconds !== undefined) node.delayTime.value = delaySeconds;
    return {input: node, output: node, params: {delaySeconds: node.delayTime}};
  },
  reverb(context, {impulse, wetGain = 0}) {
    const input = context.createGain();
    const output = context.createGain();
    const convolution = context.createConvolver();
    const wet = context.createGain();
    convolution.buffer = impulse;
    wet.gain.value = wetGain;
    input.connect(output);
    input.connect(convolution).connect(wet).connect(output);
    return {input, output, params: {wetGain: wet.gain}, dispose() {
      convolution.disconnect();
      wet.disconnect();
    }};
  },
};
