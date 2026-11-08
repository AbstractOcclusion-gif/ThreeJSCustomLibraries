// particles/pool.js -- split from aquarium_123.html (batch 4). Code moved verbatim from: WETNESS PAINT

// upload only the index span that was alive this frame
// particle pool bookkeeping (the SoA arrays stay with each system): ring-buffer slot allocation, an "anything may be
// alive" flag (skip the loop + upload entirely when false), and the alive index span uploaded after each update loop
function makePool(max, geo, attrs) {
  return { max, geo, attrs, cursor: 0, any: false, lo: 0, hi: -1,
    alloc() { this.any = true; return this.cursor++ % this.max; },                 // slot for a new particle (oldest reused)
    begin() { this.lo = this.max; this.hi = -1; },                                  // before the update loop
    mark(k) { if (k < this.lo) this.lo = k; if (k > this.hi) this.hi = k; },        // particle k is alive this frame
    end() { uploadSpan(this.geo, this.lo, this.hi, this.attrs); this.any = this.hi >= 0; } };   // upload the alive span
}
function uploadSpan(geo, lo, hi, names) {
  if (hi < lo) return; for (const nm of names) { const a = geo.attributes[nm], s = a.itemSize; a.addUpdateRange(lo * s, (hi - lo + 1) * s); a.needsUpdate = true; } }

// upload the whole buffer next frame (after a reset / respawn of every slot); also used by the ocean page's particle systems (src/ocean)
const reuploadAll = g => { for (const k in g.attributes) { const a = g.attributes[k]; a.clearUpdateRanges(); a.needsUpdate = true; } };
export { makePool, reuploadAll };
