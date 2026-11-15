import {Plane, Raycaster, Vector3} from 'three';
import {aimRay} from '../kit/input.js';
import {bindRippleGesture} from '../ripple-gesture.js';

const RIPPLE = Object.freeze({radius: 3.2, strength: .65, spacing: 1.5});
const SEA_PLANE = new Plane(new Vector3(0, 1, 0), 0);

export function bindOceanRipples({canvas, controls, camera, view, wake, isWet = () => true}) {
  const ray = new Raycaster(), impact = new Vector3();
  return bindRippleGesture(canvas, controls, event => {
    if (view.waterline) return;
    aimRay(ray, event, canvas, camera);
    if (!ray.ray.intersectPlane(SEA_PLANE, impact)) return;
    const {center, halfSize} = wake;
    if (Math.abs(impact.x - center.x) >= halfSize || Math.abs(impact.z - center.y) >= halfSize) return;
    if (isWet(impact.x, impact.z)) return impact;
  }, ({x, z}, strength) => wake.addDrop(x, z, RIPPLE.radius, RIPPLE.strength * strength), {spacing: RIPPLE.spacing});
}
