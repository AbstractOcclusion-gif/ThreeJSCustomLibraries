import * as THREE from 'three';
import {createPrecipitation as createSharedPrecipitation} from '../../particles/water/precipitation.js';
export {validatePrecipitation} from '../../particles/water/precipitation.js';

export function createPrecipitation(group, options = {}) {
 return createSharedPrecipitation({THREE, group, ...options});
}
