// The ground dust and the settlement cue use the same authored front.
export const FRONT = Object.freeze({delay: .42, pace: 41});

const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
// Reference-clock staging: column finishes before skirt fade starts; cloud last.
// Keep the existing world-second cloud lifetime unless it would violate ordering.
export function cloudFadeState(age,lifecycle,visibility,seconds=1) {
  const columnEnd=lifecycle.columnHold+lifecycle.columnFade;
  const skirtEnd=columnEnd+lifecycle.skirtFade;
  const cloudStart=Math.max(visibility.fadeStart/seconds,skirtEnd);
  const cloudEnd=Math.max(visibility.visibleSeconds/seconds,cloudStart+1);
  return {
    column:1-smooth(lifecycle.columnHold,columnEnd,age),
    skirt:1-smooth(columnEnd,skirtEnd,age),
    cloud:1-smooth(cloudStart,cloudEnd,age),
    columnEnd,skirtEnd,cloudStart,cloudEnd,
  };
}
