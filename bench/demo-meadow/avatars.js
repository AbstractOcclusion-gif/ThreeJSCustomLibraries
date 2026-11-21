import {Vector3} from 'three';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {loadCharacter} from '../character/character.js';
import {detectAssets} from '../kit/assets.js';
import {createSnowGait} from './snow-gait.js';

const localLara = import.meta.env.DEV ? import.meta.glob('../tomb/lara.js')['../tomb/lara.js'] : undefined;
const FREE = {state: 'free'};
const botJoint = /^(mixamorig)?(Left|Right)Foot(_\d+)?$/i;

export async function hasLocalLara() {
 return Boolean(localLara && await detectAssets(import.meta.env.BASE_URL + 'tomb/diffuse.png', 'tomb'));
}

async function loadLocalSnowWalk() {
 const base = import.meta.env.BASE_URL + 'meadow/';
 const response = await fetch(base + 'snow-walk.fbx');
 if (!response.ok || response.headers.get('content-type')?.startsWith('text/html')) return;
 return new FBXLoader().parse(await response.arrayBuffer(), base);
}

export async function loadMeadowAvatar(name, player, groundAt) {
 if (name === 'lara') {
  if (!localLara) throw Error('Local Lara assets are unavailable');
  const {loadLara} = await localLara();
  const [avatar, source] = await Promise.all([loadLara(player.height, groundAt), loadLocalSnowWalk().catch(error => {
   console.warn('Thaw Meadow could not load its local snow walk.', error);
  })]);
  let snowGait;
  if (source) {
   try { snowGait = createSnowGait(avatar, source, groundAt); }
   finally { disposeModel(source); }
  }
  const updateBase = (dt, controller, jumped, wish, landing) => avatar.update(dt, controller, jumped, player, FREE, {wish, landing});
  return {
   model: avatar.model, sampleFeet: snowGait?.sampleFeet ?? avatar.sampleFeet, dispose: avatar.dispose, recovery: avatar.recovery,
   reset() { snowGait?.reset(); avatar.reset(); },
   update(dt, controller, jumped, wish, deepSnow, landing) {
    if (snowGait) snowGait.update(dt, controller, jumped, wish, deepSnow, updateBase, landing);
    else updateBase(dt, controller, jumped, wish, landing);
   },
  };
 }
 const bot = await loadCharacter('bot');
 const feet = [];
 bot.model.traverse(bone => {
  const match = bone.isBone && botJoint.exec(bone.name);
  if (match) feet[match[2].toLowerCase() === 'left' ? 0 : 1] = bone;
 });
 const sole = feet.map(foot => foot.getWorldPosition(new Vector3()).y);
 return {
  model: bot.model, reset: bot.reset,
  sampleFeet(points) {
   if (feet.length !== points.length || feet.includes(undefined)) return false;
   for (const [side, point] of points.entries()) {
    feet[side].getWorldPosition(point);
    point.y -= sole[side];
    point.planted = undefined;
   }
   return true;
  },
  update(dt, controller, jumped, wish) {
   bot.update(dt, {moving: Boolean(wish.x || wish.z), speed: controller.speed, grounded: controller.grounded,
    jumped, preview: false, groundAt});
  },
 };
}

export function disposeModel(model) {
 const resources = new Set();
 model.traverse(mesh => {
  if (!mesh.isMesh) return;
  resources.add(mesh.geometry);
  for (const material of [].concat(mesh.material)) {
   resources.add(material);
   for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
  }
 });
 for (const resource of resources) resource.dispose();
}
