// ocean/readback.js -- copied from WebAquarium src/water/readback.js: the async GPU->CPU readback (WebGL2 PBO ring + fences) that
// was measured and tuned on Bert's PC (STREAM_COPY usage, lazy allocation, fence polled with clientWaitSync(0), see the aquarium
// file for the history). Generalised: one ring reads ONE float RGBA row of `width` texels; the caller issues the pass that fills
// the target and gets the samples 1-2 frames later through `collect()`.
const RING_SIZE = 3, MIN_FENCE_AGE = 2;   // ring slots; frames a fence must be old before it is polled

export class RowReadback {
  constructor(renderer, width) {
    if (!renderer.capabilities.isWebGL2) throw new Error('RowReadback needs WebGL2');
    this.renderer = renderer;
    const gl = this.gl = renderer.getContext();
    this.width = width; this.buffer = new Float32Array(width * 4); this.seq = 0;
    this.ring = Array.from({ length: RING_SIZE }, () => ({ b: gl.createBuffer(), alloc: false, fence: null, seq: 0, tag: null }));
  }
  // Call at the very START of the frame, before any new GPU work is queued (see the aquarium's notes). Returns the newest
  // finished read's tag (whatever `issue` was given) with this.buffer filled, or null.
  // Perf (Oct 2026, GPU timer): clientWaitSync is a synchronous round trip to Chrome's GPU process, which first has to catch up
  // with everything queued -- polling the fence issued LAST frame stalls the CPU for most of a frame. A fence issued two frames
  // ago has long signalled, so only those are polled; the samples arrive 2 frames late instead of 1-2, which the physics never
  // notices (MIN_FENCE_AGE).
  collect() {
    const gl = this.gl;
    let done = null;
    for (const r of this.ring) if (r.fence && this.seq - r.seq >= MIN_FENCE_AGE) { const st = gl.clientWaitSync(r.fence, 0, 0);
      if (st === gl.ALREADY_SIGNALED || st === gl.CONDITION_SATISFIED) (done ||= []).push(r); }
    if (!done) return null;
    done.sort((a, b) => a.seq - b.seq); let tag = null;
    for (const r of done) { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, r.b); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.buffer);
      gl.deleteSync(r.fence); r.fence = null; tag = r.tag; }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return tag;
  }
  // Queue an async read of `target` (a width x 1 FloatType render target that was JUST rendered and is still bound).
  // Returns false when every ring slot is still in flight (skip this frame).
  issue(target, tag) {
    const {gl, renderer} = this;
    let r = null; for (const b of this.ring) if (!b.fence) { r = b; break; } if (!r) return false;
    renderer.setRenderTarget(target);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, r.b);
    if (!r.alloc) { gl.bufferData(gl.PIXEL_PACK_BUFFER, this.width * 16, gl.STREAM_COPY); r.alloc = true; }
    gl.readPixels(0, 0, this.width, 1, gl.RGBA, gl.FLOAT, 0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    r.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush(); r.seq = ++this.seq; r.tag = tag;
    return true;
  }
  dispose() { for (const r of this.ring) { if (r.fence) this.gl.deleteSync(r.fence); this.gl.deleteBuffer(r.b); } }
}
