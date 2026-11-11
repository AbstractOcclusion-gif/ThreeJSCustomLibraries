const MAX_FRAME_SECONDS = .05;   // a slow or resumed frame advances the scene at most this much: no jump after a hitch

// The bench frame loop: frame(dt, now) runs on every visible frame. dt is in seconds, 0 on the first frame and on the first
// frame after the tab was hidden, and clamped to maxDt. onHidden() runs on frames skipped while the tab is hidden.
// Stop it with renderer.setAnimationLoop(null), as before.
export function startFrameLoop(renderer, frame, {maxDt = MAX_FRAME_SECONDS, onHidden} = {}) {
  let last = null;
  renderer.setAnimationLoop(now => {
    if (document.hidden) { last = null; onHidden?.(); return; }
    const dt = last === null ? 0 : Math.min(maxDt, Math.max(0, (now - last) / 1000)); last = now;
    frame(dt, now);
  });
}

// Run `dispose` once when the page is really left (not when it is parked in the back/forward cache).
export function onLeave(dispose) {
  const onPageHide = event => {
    if (event.persisted) return;
    removeEventListener('pagehide', onPageHide);
    dispose();
  };
  addEventListener('pagehide', onPageHide);
}
