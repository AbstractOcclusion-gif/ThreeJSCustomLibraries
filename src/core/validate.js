// Boundary checks shared by the modules, so the same mistake reads the same everywhere.
export function assertFrameTime(dt, owner) {
  if (!Number.isFinite(dt) || dt < 0) throw Error(`${owner} dt must be finite and non-negative`);
}
