const MILLISECONDS_PER_SECOND = 1000;
const FPS_WINDOW_MS = MILLISECONDS_PER_SECOND, BENCHMARK_SECONDS = 5, BENCHMARK_PERCENTILE = .95;

export function mountPerformanceControls(gui, {renderer, weather, frameRate, benchmarkResult}) {
 const profiling = gui.addFolder('Performance');
 const performanceSettings = {skyInterval: 1.25, pixelRatio: renderer.getPixelRatio(), cloudShadows: true};
 profiling.add(performanceSettings, 'skyInterval', [.35, 1.25, 8]).name('Sky refresh · s').onChange(value => weather.view.configure({sky: {captureInterval: value}}));
 profiling.add(performanceSettings, 'pixelRatio', [.75, 1, 1.25]).name('Render pixel ratio').onChange(value => renderer.setPixelRatio(value));
 profiling.add(performanceSettings, 'cloudShadows').name('Cloud shadows').onChange(enabled => weather.view.configure({appearance: {cloudShadowStrength: enabled ? 1 : 0}}));
 let benchmark;
 profiling.add({run() {
  benchmark = {start: undefined, frames: [], ratio: renderer.getPixelRatio()};
  benchmarkResult.hidden = false;
  benchmarkResult.textContent = `Measuring the current view for ${BENCHMARK_SECONDS} seconds…`;
 }}, 'run').name(`Run ${BENCHMARK_SECONDS}-second benchmark`);
 profiling.close();
 let previousNow, measuredSince, frames = 0;
 return now => {
   measuredSince ??= now;
   if (now - measuredSince >= FPS_WINDOW_MS) {
    const frameTime = (now - measuredSince) / frames;
    frameRate.textContent = `${Math.round(MILLISECONDS_PER_SECOND / frameTime)} fps · ${frameTime.toFixed(1)} ms/frame`;
    measuredSince = now;
    frames = 0;
   }
   frames++;
   if (benchmark) {
    if (benchmark.start === undefined) benchmark.start = now;
    else if (previousNow !== undefined) benchmark.frames.push(now - previousNow);
    if (now - benchmark.start >= (BENCHMARK_SECONDS * MILLISECONDS_PER_SECOND)) {
     const sorted = benchmark.frames.sort((a, b) => a - b);
     const p95 = sorted[Math.ceil(sorted.length * BENCHMARK_PERCENTILE) - 1];
     const fps = sorted.length * MILLISECONDS_PER_SECOND / (now - benchmark.start);
     benchmarkResult.textContent = `${fps.toFixed(1)} fps average · ${p95.toFixed(1)} ms p95 · ${benchmark.ratio} pixel ratio`;
     benchmark = undefined;
    }
   }
   previousNow = now;
 };
}
