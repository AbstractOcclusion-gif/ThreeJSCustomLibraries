// particles/motes.js -- suspended particles lit by the caustics / god-ray shafts (aquarium particles/motes.js, minus the fish
// stirring): a cloud of points wrapped around the camera, drawn only below the surface, inside the scene so the composite fogs
// them with distance. Brightness = ambient floor + the caustic focus where no object shadows the sun, dimmed by depth.
import * as THREE from 'three';

export const MOTE_DEFAULTS = Object.freeze({ on: true, count: 2500, radius: 18, size: 0.05, brightness: 1, drift: 0.15 });
const MAX = 6000;

export class Motes {
  constructor({scene, sun, ambient, optics, caustics, settings = {}}) {
    this.s = { ...MOTE_DEFAULTS, ...settings }; this.center = new THREE.Vector3();
    this.pos = new Float32Array(MAX * 3); this.seed = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) { this.seed[i] = Math.random(); this.pos[i * 3] = Math.random() * 2 - 1; this.pos[i * 3 + 1] = Math.random() * 2 - 1; this.pos[i * 3 + 2] = Math.random() * 2 - 1; }   // unit cube, scaled by radius
    this.geo = new THREE.BufferGeometry(); this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); this.geo.setAttribute('seed', new THREE.BufferAttribute(this.seed, 1));
    this.material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...caustics?.uniforms, uExtinction: optics?.uExtinction ?? {value: new THREE.Vector3(.62, .058, .038)},
        uDepthDarken: optics?.uDepthDarken ?? {value: .6}, uSurfaceY: {value: 0}, uCenter: { value: this.center },
        uRadius: { value: this.s.radius }, uTime: { value: 0 }, uDrift: { value: this.s.drift },
        uSize: { value: this.s.size }, uBright: { value: this.s.brightness }, uViewportHeight: { value: 1 },
        uSunCol: sun ?? {value: new THREE.Color(1, .95, .85)}, uAmb: ambient ?? {value: new THREE.Color(.3, .3, .3)} },
      vertexShader: /* glsl */`attribute float seed; uniform vec3 uCenter, uExtinction; uniform float uRadius, uTime, uDrift, uSize, uBright, uViewportHeight, uDepthDarken, uSurfaceY; varying float vB;
        ${caustics?.glsl ?? 'float causticRaw(vec3 p) { return 1.0; }'}
        void main(){ vec3 p = uCenter + fract((position * 0.5 + 0.5) + vec3(seed * 0.3, 0.0, seed * 0.7) + uTime * uDrift * vec3(0.01, 0.004, 0.007) * (0.5 + seed)) * 2.0 * uRadius - uRadius;   // wrap in the cube around the camera
          p += vec3(sin(uTime * 0.3 + seed * 20.0), cos(uTime * 0.2 + seed * 13.0), sin(uTime * 0.25 + seed * 7.0)) * 0.3;
          float depth = uSurfaceY - p.y; if (depth < 0.05) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vB = 0.0; return; }
          float c = causticRaw(p); vec3 dw = exp(-uExtinction * (uDepthDarken * depth));
          vB = (0.25 + max(c - 0.6, 0.0) * 1.6) * uBright * (0.5 + seed) * (dw.g * 0.7 + dw.b * 0.3);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = (0.6 + seed * 0.8) * uSize * uViewportHeight / max(-mv.z, 0.2); }`,
      fragmentShader: /* glsl */`uniform vec3 uSunCol, uAmb; varying float vB; void main(){ if (vB <= 0.0) discard; float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
        gl_FragColor = vec4((uAmb + uSunCol * 0.8) * vB * (1.0 - d * 2.0) * 0.5, 1.0);
        #include <colorspace_fragment>
      }` });
    this.points = new THREE.Points(this.geo, this.material); this.points.frustumCulled = false; this.points.renderOrder = 5;
    this.points.visible = false;
    scene?.add(this.points);
    this.applySettings();
  }
  applySettings(settings = {}) { const s = Object.assign(this.s, settings), u = this.material.uniforms; u.uRadius.value = s.radius; u.uSize.value = s.size; u.uBright.value = s.brightness; u.uDrift.value = s.drift; this.geo.setDrawRange(0, Math.min(MAX, s.count)); }
  update(dt, {cameraPosition, height, viewportHeight}) {
    this.points.visible = this.s.on && cameraPosition.y < height;
    this.material.uniforms.uTime.value += dt;
    this.material.uniforms.uSurfaceY.value = height;
    this.material.uniforms.uViewportHeight.value = viewportHeight;
    this.center.copy(cameraPosition);
  }
  dispose() { this.points.removeFromParent(); this.geo.dispose(); this.material.dispose(); }
}
