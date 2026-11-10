// Offscreen-pass scope: runs draw() and puts back the renderer state it may change: render target (with cube face and mip
// level), viewport, scissor and scissor test, and the clear colour and alpha when `clearColor` is set. `scissorOff` makes the
// pass draw unscissored. Saved states sit on a small stack allocated on first use, so nested scopes are safe and a per-frame
// pass stays garbage-free. Returns draw()'s result.
import {Color, Vector4} from 'three';

export function createRenderScope(renderer, {clearColor = true, scissorOff = true} = {}) {
  const stack = [];
  let depth = 0;
  return draw => {
    const s = stack[depth] ??= {viewport: new Vector4(), scissor: new Vector4(), color: new Color(), target: null, face: 0, level: 0, scissorTest: false, alpha: 1};
    depth++;
    s.target = renderer.getRenderTarget();
    s.face = renderer.getActiveCubeFace();
    s.level = renderer.getActiveMipmapLevel();
    s.scissorTest = renderer.getScissorTest();
    renderer.getViewport(s.viewport);
    renderer.getScissor(s.scissor);
    if (clearColor) { renderer.getClearColor(s.color); s.alpha = renderer.getClearAlpha(); }
    try {
      if (scissorOff) renderer.setScissorTest(false);
      return draw();
    } finally {
      depth--;
      renderer.setRenderTarget(s.target, s.face, s.level);
      renderer.setViewport(s.viewport);
      renderer.setScissor(s.scissor);
      renderer.setScissorTest(s.scissorTest);
      if (clearColor) renderer.setClearColor(s.color, s.alpha);
      s.target = null;
    }
  };
}
