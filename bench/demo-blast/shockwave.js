import {Camera, HalfFloatType, Mesh, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget} from 'three';
import {createRenderScope} from '../../src/core/render-state.js';

const WAVE = Object.freeze({delay: .18, speed: 95, duration: 2.8, width: 6, distortion: .008});

// Brief screen-space compression front. Scene coordinates keep it centred on the
// detonation when the camera moves. UI is composed by the browser afterwards.
export function createShockwave(renderer, scale) {
  const target = new WebGLRenderTarget(1, 1, {type: HalfFloatType, depthBuffer: false});
  const uniforms = {
    frame: {value: null}, centre: {value: new Vector2()},
    radius: {value: 0}, width: {value: .01}, strength: {value: 0},
    aspect: {value: 1},
  };
  const material = new ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false, toneMapped: false,
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: /* glsl */`
      uniform sampler2D frame;
      uniform vec2 centre;
      uniform float radius,width,strength,aspect;
      varying vec2 vUv;
      void main(){
        vec2 scale=vec2(aspect,1.);
        vec2 delta=(vUv-centre)*scale;
        float distance=length(delta);
        float edge=(distance-radius)/max(width,.001);
        float shell=exp(-edge*edge*2.);
        vec2 normal=delta/max(distance,.0001);
        vec2 bent=clamp(vUv-normal/scale*shell*strength,.001,.999);
        vec3 color=texture2D(frame,bent).rgb;
        color+=vec3(.24,.23,.2)*shell*strength*8.;
        gl_FragColor=vec4(color,1.);
      }
    `,
  });
  const geometry = new PlaneGeometry(2, 2), quad = new Mesh(geometry, material);
  const scene = new Scene(), eye = new Camera();
  scene.add(quad);
  const scope = createRenderScope(renderer);
  const centre = new Vector3(), edge = new Vector3(), right = new Vector3();
  return {
    render(color, camera, origin, time, enabled = true) {
      const age = time - (scale ? 0 : WAVE.delay);
      const duration = scale ? WAVE.duration * Math.cbrt(scale.yieldKt) : WAVE.duration;
      if (!enabled || age < 0 || age > duration) return color;
      const image = color.image;
      if (target.width !== image.width || target.height !== image.height) target.setSize(image.width, image.height);
      camera.updateMatrixWorld();
      centre.copy(origin).y += 5;
      const worldRadius = scale ? scale.shock.radiusAt(age) : age * WAVE.speed;
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      edge.copy(centre).addScaledVector(right, worldRadius).project(camera);
      centre.project(camera);
      const aspect = target.width / target.height;
      const radius = Math.abs(edge.x - centre.x) * .5 * aspect;
      uniforms.frame.value = color;
      uniforms.aspect.value = aspect;
      uniforms.centre.value.set(centre.x * .5 + .5, centre.y * .5 + .5);
      uniforms.radius.value = radius;
      uniforms.width.value = Math.max(.004, radius * WAVE.width * (scale?.length ?? 1) / Math.max(1, worldRadius));
      uniforms.strength.value = centre.z > 1 ? 0 : WAVE.distortion * Math.sin(Math.PI * age / duration);
      scope(() => { renderer.setRenderTarget(target); renderer.render(scene, eye); });
      return target.texture;
    },
    dispose() { target.dispose(); geometry.dispose(); material.dispose(); },
  };
}
