import {Color, MathUtils, Vector3} from 'three';
import {seededRandom} from '../../src/core/hash.js';
import {createNoiseVolume} from '../../src/core/volume-noise.js';
import {createPuffs} from '../../src/particles/index.js';
import {PREFAB_SHEETS} from '../../src/particles/prefabs.js';
import {createFireball} from './fireball.js';
import {BURNING, FIRE_LOOK, INNER_LIGHT, FIERY_PHASE, ignitionScale, visibleHeat, columnFormation} from './fire-look.js';
import {createPlumeFlow} from './plume-flow.js';
import {FRONT} from './timing.js';
import {plumeOffset, skirtHeightShare} from './plume-motion.js';
import {CLOUD_TINT, DUST_TINT} from './palette.js';
import {BLAST_QUALITY} from './quality.js';
import {createLateCloud, mapLatePoint} from './late-cloud.js';
import {installBlastPuffBlend} from './puff-blend.js';
import {createCloudSettings} from './cloud-settings.js';

const TURN = 2 * Math.PI;
const SEED = 17;

// Standalone visual prefab for a host scene. The host decides when to play and owns scene reactions.
export async function createMushroomCloud(scene, {environment, size = 1, seed = SEED, fireLook = {...FIRE_LOOK}, quality = BLAST_QUALITY.high, scale = null, settings = createCloudSettings(scale)} = {}) {
  if (!Number.isFinite(size) || size <= 0) throw new RangeError('Cloud size must be positive');
  const {billows:CLOUD_BILLOWS,groundDust:BASE_DUST,growth:PUFF_GROWTH,blend:PARCEL_BLEND,
    skirt:SKIRT,shared:SHARED_CLOUD,feed:GROUND_FEED,groundRing:GROUND_APRON,ringFormation:RING_FORMATION}=settings;
  const DISSIPATION={get baseEnd(){return BASE_DUST.life[1]+3.5;},columnSeconds:10,cloudSeconds:18};
  fireLook.rollMotion=settings.roll;
  const count = n => Math.max(1, Math.round(n * quality.puffScale));
  let counts;
  const origin = new Vector3();
  const flow = createPlumeFlow(origin, size, fireLook, quality.fluid);
  const noiseVolume = createNoiseVolume({seed});
  const parcels = [];
  const puffSelfShadow={value:fireLook.selfShadow??FIRE_LOOK.selfShadow};
  const puffLightScatter={value:fireLook.lightScatter??FIRE_LOOK.lightScatter};
  const puffScene = {add(sprite) {
    sprite.userData.blastPuffBlend=installBlastPuffBlend(sprite,puffSelfShadow,puffLightScatter,settings.roll);
    parcels.push(sprite);scene.add(sprite);
  },remove(sprite) {scene.remove(sprite);}};
  const puffs = await createPuffs(puffScene, {
    environment, flow, noiseVolume,
    onEmit(sprite,{flowTag}) {
      sprite.userData.cloudFlowTag=flowTag;
      sprite.userData.blastPuffBlend.setTag(flowTag);
      sprite.userData.blastBirthAge=time;
      if(flowTag?.base) sprite.userData.groundY=sprite.position.y;
      delete sprite.userData.heatFade;
      delete sprite.userData.fullOpacity;
      delete sprite.userData.ringRest;
    },
    pool: quality.puffPool,
    windResponse: .38,
    sheets: {impact: PREFAB_SHEETS.impact},
    swirl: {eddy: 12 * size, rise: 5 * size, ramp: .8, seed},
  }).catch(error => { noiseVolume.dispose(); throw error; });
  const fireball = createFireball(scene, fireLook, noiseVolume, flow, environment, quality.raySteps);
  const point = new Vector3(), eye = new Vector3(), parcelDistances = [], parcelOpacities = [];
  const fireColor = new Color(INNER_LIGHT.color);
  let time = 0, next = 0, timeline = [];
  let skirtBursts = 0, nextSkirt = 0;
  let late = null, handoffTime = 0, snapshots = [];
  let ignitionParcels = [];
  const billowScale=()=>fireLook.cloudMotion==='shared'?SHARED_CLOUD.billowScale:1;
  let detailWidth=CLOUD_BILLOWS.width*CLOUD_BILLOWS.birthScale*billowScale();

  function restoreIgnition() {
    for(const {sprite,position,width,opacity} of ignitionParcels) {
      sprite.position.copy(position);sprite.scale.copy(width);
      if(opacity!==undefined) sprite.material.opacity=opacity;
    }
    ignitionParcels=[];
  }

  function restoreParcels() {
    for (const {sprite,position,width,opacity} of snapshots) {
      sprite.position.copy(position);sprite.scale.copy(width);sprite.material.opacity=opacity;
    }
  }
  function sort(camera) {
    restoreIgnition();
    if (late) {
      const state=late.state;
      for (const {sprite,position,width,opacity,tag} of snapshots) {
        const y=(position.y-origin.y)/size;
        const ground=tag.kind==='ground';
        if(ground) sprite.position.copy(position);
        else mapLatePoint(sprite.position,position,origin,size,state);
        const share=Math.max(0,Math.min(1,y/state.referenceJoin));
        const progress=Math.max(0,Math.min(1,(time-handoffTime)/(settings.visibility.visibleSeconds/scale.seconds-handoffTime)));
        const lateGrowth=1+PUFF_GROWTH.lateGain*(1-(1-progress)**3);
        sprite.scale.copy(width).multiplyScalar(ground?1:(1+(state.expansion-1)*share)*lateGrowth);
        if(tag.kind==='head'||tag.kind==='skirt')
          sprite.userData.blastPuffBlend.setDetailScale(width.y/(size*detailWidth)*lateGrowth);
        const headShare=MathUtils.smoothstep(y,flow.head.height*.4,flow.head.height*.65);
        const groundFade=1-MathUtils.smoothstep(time,DISSIPATION.baseEnd,DISSIPATION.baseEnd+10);
        const stemFade=state.columnOpacity*(1-MathUtils.smoothstep(time,GROUND_FEED.end,GROUND_FEED.columnEnd));
        const fade=ground?1:y<12?groundFade:MathUtils.lerp(stemFade,state.cloudOpacity,headShare);
        const water=1-Math.exp(-state.liquidExtinction*width.y*state.expansion*.25);
        // Optical depth the gas keeps through the expanded cloud; parcels follow it.
        const depth=state.density*state.expansion;
        const retention=ground?1:Math.min(1,1+(depth-1)*share+water*headShare);
        sprite.material.opacity=opacity*fade*retention*(sprite.userData.heatFade??1);
        sprite.visible=sprite.material.opacity>1e-4;
      }
    }
    // Vertical-only limit. Keep authored horizontal sizes, positions and spread.
    for(const sprite of parcels) if(sprite.visible && sprite.userData.cloudFlowTag?.base) {
      sprite.position.y=sprite.userData.groundY;
      const aboveGround=(sprite.position.y-origin.y)/size;
      sprite.scale.y=Math.min(sprite.scale.y,2*Math.max(1,BASE_DUST.maxTop-aboveGround)*size);
    }
    // Settle the ground layer over the same interval as column shutdown.
    // These are render transforms, restored before the next simulation update.
    const settling=MathUtils.smoothstep(time,GROUND_FEED.end,GROUND_FEED.columnEnd);
    for(const sprite of parcels) if(sprite.visible && sprite.userData.cloudFlowTag?.kind==='ground') {
      const apron=!sprite.userData.cloudFlowTag.base;
      if(!apron&&settling<=0)continue;
      ignitionParcels.push({sprite,position:sprite.position.clone(),width:sprite.scale.clone(),opacity:sprite.material.opacity});
      if(apron){
        if(time>=RING_FORMATION.stop&&!sprite.userData.ringRest)
          sprite.userData.ringRest={x:sprite.position.x,z:sprite.position.z,width:sprite.scale.clone()};
        const rest=sprite.userData.ringRest;
        if(rest){sprite.position.x=rest.x;sprite.position.z=rest.z;sprite.scale.copy(rest.width);}
        else {
          const forming=MathUtils.smoothstep(time,FRONT.delay,RING_FORMATION.buildEnd);
          sprite.scale.y*=.65+.35*forming;
          sprite.material.opacity*=.25+.75*forming;
        }
      }
      sprite.position.y=MathUtils.lerp(sprite.position.y,origin.y+.3*size,settling);
      sprite.scale.y*=1-.8*settling;
      sprite.material.opacity*=1-settling;
    }
    // Reveal the column from the ground upward. The skirt first rides the
    // feeding tip, then opens into its original authored location and radius.
    // All transforms are restored before simulation; exactly neutral at t=12.
    if(time<12) {
      const formation=columnFormation(time,flow.head.height,flow.head.radius);
      for(const sprite of parcels) if(sprite.visible) {
        const tag=sprite.userData.cloudFlowTag;
        if(tag?.kind!=='head'&&tag?.kind!=='skirt')continue;
        ignitionParcels.push({sprite,position:sprite.position.clone(),width:sprite.scale.clone(),opacity:sprite.material.opacity});
        if(tag.kind==='skirt') {
          const feed=MathUtils.smoothstep(time,5,12);
          const offset=plumeOffset((sprite.position.y-origin.y)/size,time,flow.head.height);
          sprite.position.x=origin.x+offset[0]*size+(sprite.position.x-origin.x-offset[0]*size)*(.25+.75*feed);
          sprite.position.z=origin.z+offset[1]*size+(sprite.position.z-origin.z-offset[1]*size)*(.25+.75*feed);
          sprite.position.y=MathUtils.lerp(origin.y+formation.tip*size,sprite.position.y,feed);
          sprite.material.opacity*=MathUtils.smoothstep(time,3,6);
        } else {
          const y=(sprite.position.y-origin.y)/size;
          sprite.material.opacity*=MathUtils.lerp(MathUtils.smoothstep(y,formation.join-2,formation.join+2),1,formation.connected);
        }
      }
    }
    const expansion=ignitionScale(time);
    if(timeline.length && expansion<1) {
      for(const sprite of parcels) if(sprite.visible) {
        ignitionParcels.push({sprite,position:sprite.position.clone(),width:sprite.scale.clone()});
        sprite.position.sub(origin).multiplyScalar(expansion).add(origin);
        sprite.scale.multiplyScalar(expansion);
      }
    }
    camera.getWorldPosition(eye);
    parcelDistances.length = 0;
    parcelOpacities.length=0;
    for (const sprite of parcels) if (sprite.visible && sprite.material.opacity>1e-4) {
      parcelDistances.push(sprite.position.distanceTo(eye));parcelOpacities.push(sprite.material.opacity);
    }
    fireball.sort(camera, parcelDistances, parcelOpacities);
  }

  // The dense gas supplies the initial cooling smoke. Upper detail parcels blend
  // in gradually afterward, rather than appearing as soon as their centres cool.
  // Ground dust retains its immediate response. Runs after the pool update.
  function lightParcel(sprite, heatScale, fire, dt) {
    const {position, material} = sprite;
    sprite.userData.blastPuffBlend.setClock(time,sprite.userData.blastBirthAge??time);
    if(['head','skirt'].includes(sprite.userData.cloudFlowTag?.kind))
      sprite.userData.blastPuffBlend.setDetailScale(sprite.scale.y/(size*detailWidth));
    const ground=sprite.userData.cloudFlowTag?.kind==='ground';
    const y=(position.y-origin.y)/size,offset=plumeOffset(y,time,flow.head.height);
    const r=Math.hypot((position.x-origin.x)/size-offset[0],(position.z-origin.z)/size-offset[1]);
    const solvedHeat=flow.heatAt(position.x,position.y,position.z)*heatScale;
    const heat=ground?solvedHeat:visibleHeat(solvedHeat,time,r,y,flow.head.height,flow.head.radius);
    const skirt=sprite.userData.cloudFlowTag?.kind==='skirt';
    const retained=1-MathUtils.smoothstep(time,FIERY_PHASE.fadeStart,FIERY_PHASE.fadeEnd);
    sprite.userData.blastPuffBlend.setHeat(skirt?retained*(.65+.35*MathUtils.smoothstep(r/Math.max(13,flow.head.radius),.35,.85)):0);
    const cloudShare=MathUtils.smoothstep((position.y-origin.y)/size,4,12);
    const detail=MathUtils.smoothstep(time,PARCEL_BLEND.detailStart,PARCEL_BLEND.detailEnd);
    const cooled=1-MathUtils.smoothstep(skirt?solvedHeat:heat,BURNING.from,BURNING.to);
    const target=ground?cooled:MathUtils.lerp(cooled,cooled*detail,cloudShare);
    const previous = sprite.userData.heatFade ?? target;
    const seconds = target < previous ? PARCEL_BLEND.heatingSeconds : PARCEL_BLEND.coolingSeconds;
    // A centre sample crossing a grid cell must not switch an entire puff's
    // visibility in one frame. Retain the shared burn range, easing the handoff.
    const fade = ground?target:MathUtils.lerp(previous,target,1-Math.exp(-dt/seconds));
    sprite.userData.heatFade = fade;
    const alpha = Math.max(0,Math.min(1,material.opacity));
    const denseAlpha = ground?alpha:1-(1-alpha)**PARCEL_BLEND.opticalDepth;
    sprite.userData.fullOpacity = denseAlpha;
    material.opacity = denseAlpha*fade;
    point.copy(position).sub(origin).divideScalar(size).sub(fire.centre);
    const lit = INNER_LIGHT.albedo * fire.intensity / (1 + point.lengthSq() / (fire.radius * fire.radius));
    material.color.r += fireColor.r * lit;
    material.color.g += fireColor.g * lit;
    material.color.b += fireColor.b * lit;
  }
  function lightParcels(dt) {
    const fire = fireball.fire, heatScale = late?.state.heat ?? 1;
    if (late) for (const {sprite} of snapshots) lightParcel(sprite, heatScale, fire, dt);
    else for (const sprite of parcels) if (sprite.visible) lightParcel(sprite, heatScale, fire, dt);
  }

  function emitGrowingPuff(mask, position, velocity, width, life, tint, index, look) {
    // Ground dirt keeps its established full-size birth and linear growth.
    if(look?.flowTag?.kind==='ground') {
      return puffs.emit(mask,position,velocity,width,life,tint,index,{...look,growthEase:look.growthEase??0});
    }
    if(fireLook.cloudMotion==='shared'&&['head','skirt'].includes(look?.flowTag?.kind)) {
      // The head follows gas; the skirt retains its existing collar guidance.
      // Neither needs an extra launch kick or separate environment wind.
      width*=billowScale();velocity=[0,0,0];look={...look,wind:0,swirl:0};
    }
    // Existing linear grow is a gain relative to birth size. Rescale both ends
    // so a small newborn still reaches the previously authored mature size.
    const birthScale=look?.flowTag?.kind==='head'?CLOUD_BILLOWS.birthScale:PUFF_GROWTH.birthScale;
    return puffs.emit(mask,position,velocity,width*birthScale,life,tint,index,
      {...look,growthEase:4.5,grow:(1+(look?.grow??.8))/birthScale-1});
  }
  function emit({at, mask, offset, velocity, width, life, tint, look}, elapsed) {
    // Catch up sub-frame emissions without moving every newly due puff an entire frame.
    point.copy(origin).addScaledVector(offset, size).addScaledVector(velocity, size * Math.max(0, elapsed - at));
    const smoke = mask === 'plume';
    emitGrowingPuff(smoke ? 'dust-soft' : mask, point, velocity.toArray().map(value => value * size), width * size, life, tint, 0, look);
  }

  function start(position) {
    clear();
    counts={...Object.fromEntries(Object.entries(settings.emission).map(([k,n])=>[k,n===0?0:count(n)])),
      base:count(BASE_DUST.count),apron:Math.max(GROUND_APRON.count,count(GROUND_APRON.count)),skirt:count(SKIRT.parcels)};
    origin.copy(position);
    flow.ignite();
    const random = seededRandom(seed);
    const range = (low, high) => MathUtils.lerp(low, high, random());
    const add = (at, mask, offset, velocity, width, life, tint, look) => {
      const turn = random();
      const volume = mask === 'plume';
      timeline.push({at, mask, offset, velocity, width, life, tint,
        look: {rotation: volume ? 0 : turn * TURN, volume, volumeSeed: turn, ...look}});
    };
    // Small parcels mark the initial hot volume and are carried by the solved flow.
    // Their edges show the actual overturning without prescribing a mushroom path.
    for (let i = 0; i < counts.head; i++) {
      const angle = i * 2.399963, r = 11 * Math.sqrt(random()), y = range(5, 23);
      add(range(.05, .7), 'plume',
        new Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r), new Vector3(),
        // Match skirt-scale billows, retaining one seeded draw and modest variety.
        range(CLOUD_BILLOWS.width*(1-CLOUD_BILLOWS.variation),CLOUD_BILLOWS.width*(1+CLOUD_BILLOWS.variation)),
        scale ? range(45,60) : range(20, 30), CLOUD_TINT[i % 3 ? 0 : 1],
        {grow: CLOUD_BILLOWS.grow, opacity: .72, hold: PARCEL_BLEND.hold, fadeIn: 3.8, flow: 1,
          flowTag:{kind:'head'},wind: .02, swirl: 0});
    }
    // The host exposure flash and the gas volume own luminous energy. A separate
    // additive flash billboard cannot be absorbed correctly by intersecting smoke.
    for (let i = 0; i < counts.fire; i++) {
      const at = range(.08, 1), angle = i * TURN / counts.fire, radius = range(2, 12);
      const x = Math.cos(angle), z = Math.sin(angle);
      const hot = i % 3 !== 0;
      add(at, 'plume',
        new Vector3(x * radius, range(1.2, 5.5), z * radius),
        new Vector3(x * range(2.3, 8.5), range(2, 6), z * range(2.3, 8.5)),
        range(3, 7), range(3.8, 6.4), 0x6e5240,
        {grow: 1.6, opacity: hot ? .2 : .88, fadeIn: .06, wind: .15, swirl: .3 * size});
    }
    // A low, ragged skirt of dust races across the terrain along the settlement cue.
    for (let i = 0; i < counts.front; i++) {
      const angle = (i + range(-.36, .36)) * TURN / counts.front;
      const x = Math.cos(angle), z = Math.sin(angle), radius = range(8, 14);
      add(FRONT.delay + radius / FRONT.pace, 'impact',
        new Vector3(x * radius, range(1.4, 4), z * radius),
        new Vector3(x * FRONT.pace * .3, range(1.2, 3), z * FRONT.pace * .3),
        range(14, 24), range(3, 4.7), 0xd3ae85,
        {grow: .9, drag: .4, opacity: range(.72, 1), fadeIn: .13, aspect: 1.9, rotation: range(-.13, .13), wind: .2});
    }
    // Broad soft puffs carry the density of the wave, the flipbook adds its dusty edges.
    for (let i = 0; i < counts.mist; i++) {
      const angle = i * TURN / counts.mist, x = Math.cos(angle), z = Math.sin(angle);
      add(FRONT.delay + 12 / FRONT.pace, 'dust-soft', new Vector3(x * 12, 3.6, z * 12),
        new Vector3(x * FRONT.pace * .3, 2.7, z * FRONT.pace * .3), range(22, 28), 4, 0xc69c73,
        {grow: 1.45, drag: .4, opacity: .58, fadeIn: .17, aspect: 1.8, rotation: 0, wind: .2});
    }
    // Residual dust stays around the crater after the fast front has passed.
    for (let i = 0; i < counts.base; i++) {
      const angle = i * TURN / counts.base + range(-.12, .12);
      const edge = i % 2 === 0;
      const radius = edge ? range(12, 20) : range(2, 7);
      const x = Math.cos(angle), z = Math.sin(angle);
      const speed = edge ? range(...BASE_DUST.edgeSpeed) : range(.18, .42);
      add(range(.65, 3.5), 'plume',
        new Vector3(x * radius, range(3, 7), z * radius),
        new Vector3(x * speed, range(.01, .045), z * speed),
        range(...(edge ? BASE_DUST.edgeWidth : BASE_DUST.width)),
        range(...BASE_DUST.life), DUST_TINT[i % 3 ? 0 : 1],
        {grow: edge?BASE_DUST.edgeGrow:1.2, opacity: .9, hold: PARCEL_BLEND.hold, fadeIn: 1.1,
          flow: 0,flowTag:{kind:'ground',base:true},wind: .035, swirl: 0});
    }
    // The expanding front leaves a broad, low rolling perimeter behind it.
    for (let i = 0; i < counts.apron; i++) {
      const angle = i * TURN / counts.apron + range(-.04, .04);
      const radius = GROUND_APRON.startRadius;
      const speed = (range(...GROUND_APRON.radius) - radius) * GROUND_APRON.drag;
      const x = Math.cos(angle), z = Math.sin(angle);
      add(FRONT.delay + radius / FRONT.pace, 'plume',
        new Vector3(x * radius, range(3.5, 6), z * radius),
        new Vector3(x * speed, range(.025, .08), z * speed),
        range(4, 6), range(...GROUND_APRON.life), i % 3 ? 0x8c7864 : 0xb49c7c,
        {grow: 4.5, growthEase: 4.5, opacity: .86, hold: PARCEL_BLEND.hold, fadeIn: .35, flow: 0,flowTag:{kind:'ground'},roll: true,
          drag: GROUND_APRON.drag, wind: .04, swirl: 0});
    }
    timeline.sort((a, b) => a.at - b.at);
    update(0);
  }

  function update(dt) {
    puffSelfShadow.value=fireLook.selfShadow??FIRE_LOOK.selfShadow;
    puffLightScatter.value=fireLook.lightScatter??FIRE_LOOK.lightScatter;
    restoreIgnition();
    restoreParcels();
    time += dt;
    if (!timeline.length) return;
    const columnEnd = DISSIPATION.baseEnd + DISSIPATION.columnSeconds;
    const cloudEnd = columnEnd + DISSIPATION.cloudSeconds;
    if (scale && !late && time >= 36 && skirtBursts >= SKIRT.bursts) {
      late=createLateCloud(scale,{...flow.head,rise:flow.riseSpeed,offset:plumeOffset(flow.head.height,time,flow.head.height)},time*scale.seconds,
        {...settings.late,profile:settings.visibility});
      handoffTime=time;
    }
    if (late && late.state.cloudOpacity>0) late.update(dt*scale.seconds,environment?.wind);
    if (late?.state.cloudOpacity<=0 && snapshots.length) {puffs.clear();snapshots=[];}
    const columnOpacity = (1-MathUtils.smoothstep(time,GROUND_FEED.end,GROUND_FEED.columnEnd)) *
      (late ? late.state.columnOpacity : scale ? 1 : 1-MathUtils.smoothstep(time,DISSIPATION.baseEnd,columnEnd));
    const cloudOpacity = late ? late.state.cloudOpacity : scale ? 1 : 1-MathUtils.smoothstep(time,columnEnd,cloudEnd);
    flow.setGroundFeed(1-MathUtils.smoothstep(time,GROUND_FEED.taper,GROUND_FEED.end));
    // Continue solving and aging in the local cloud frame after bulk ascent begins.
    // Bound steps even during time-lapse; never discard the fluid clock's backlog.
    const localDt=dt;
    const steps=Math.max(1,Math.ceil(localDt/.04));
    for(let i=0;i<steps;i++) {
      flow.update(localDt/steps);
      // The cloud's bulk opacity owns late dissipation. Retain its existing
      // billows instead of expiring them while the cloud is still visible;
      // advection and procedural rolling keep their normal reference clock.
      puffs.update(localDt/steps,late?{ageDt:0}:undefined);
    }
    if(late && cloudOpacity>0) {
      // The bulk thermal owns ascent. Re-anchor the evolving local field so its
      // own head rise cannot add a second climb after the thermal has settled.
      const shift=flow.head.height-late.state.referenceHeight;
      late.state.referenceHeight=flow.head.height;
      late.state.referenceJoin=Math.max(8,late.state.referenceJoin+shift);
      let count=0;
      for(const sprite of parcels) if(sprite.visible) {
        const snapshot=snapshots[count]??{position:new Vector3(),width:new Vector3()};
        snapshot.sprite=sprite;snapshot.position.copy(sprite.position);snapshot.width.copy(sprite.scale);
        snapshot.opacity=sprite.material.opacity;snapshot.tag=sprite.userData.cloudFlowTag??{};
        snapshots[count++]=snapshot;
      }
      snapshots.length=count;
    }
    const animationTime=time;
    let widths=0,widthCount=0;
    for(const sprite of parcels)if(sprite.visible&&sprite.userData.cloudFlowTag?.kind==='head'){
      widths+=sprite.scale.y/size;widthCount++;
    }
    if(widthCount)detailWidth=widths/widthCount;
    fireball.update(dt, animationTime, origin, size, {columnOpacity,cloudOpacity,
      late:late?.state,shapeAge:animationTime,billowWidth:detailWidth});
    while (next < timeline.length && timeline[next].at <= time) emit(timeline[next++], time);
    if (flow.head.height >= SKIRT.startHeight && skirtBursts < SKIRT.bursts && time >= nextSkirt) {
      const radiusShare = .8 + skirtBursts * .04;
      const height = flow.head.height * skirtHeightShare(radiusShare);
      const radius = Math.max(4, flow.head.radius * .22);
      const offset = plumeOffset(height, time, flow.head.height);
      for (let i = 0; i < counts.skirt; i++) {
        const angle = (i + skirtBursts * .37) * TURN / counts.skirt;
        const x = Math.cos(angle), z = Math.sin(angle);
        point.set(
          origin.x + (offset[0] + x * radius) * size,
          origin.y + (height + Math.sin(angle * 3 + skirtBursts) * 2) * size,
          origin.z + (offset[1] + z * radius) * size
        );
        const innerBlend = 1 - MathUtils.smoothstep(radiusShare, .35, .85);
        emitGrowingPuff('dust-soft', point, [x*3*size, 0, z*3*size],
          CLOUD_BILLOWS.width * size, 40, CLOUD_TINT[i % 3 ? 0 : 1], 0,
          {volume: true, volumeSeed: i * .137 + skirtBursts * .23, rotation: 0,
            grow: CLOUD_BILLOWS.grow, opacity: .7 - .08 * innerBlend, hold: PARCEL_BLEND.hold, fadeIn: .8, flow: 1, roll: true,
            flowTag: {kind: 'skirt', radiusShare}, drag: .8, wind: .01});
      }
      skirtBursts++;
      nextSkirt = time + SKIRT.interval;
    }
    lightParcels(dt);
    // Sorting must retain the same optical-depth boost as the early renderer.
    // heatFade is applied by sort, so capture the unfaded, boosted opacity.
    if(late) for(const snapshot of snapshots) snapshot.opacity=snapshot.sprite.userData.fullOpacity??snapshot.opacity;
  }

  function clear() {
    restoreIgnition();
    restoreParcels();
    late=null;snapshots=[];handoffTime=0;
    puffs.clear();
    for (const sprite of parcels) delete sprite.userData.heatFade;
    fireball.clear();
    flow.reset();
    timeline = [];
    time = next = 0;
    detailWidth=CLOUD_BILLOWS.width*CLOUD_BILLOWS.birthScale*billowScale();
    skirtBursts = nextSkirt = 0;
  }

  return {
    start, update, clear, settings,
    sampleSkirtEdge(out,index=0) {
      const candidates=parcels.filter(sprite=>sprite.visible&&sprite.material.opacity>.05&&sprite.userData.cloudFlowTag?.kind==='skirt'&&sprite.userData.cloudFlowTag.radiusShare>=.88);
      if(!candidates.length)return false;
      const sprite=candidates[(index*3)%candidates.length];
      out.copy(sprite.position);out.y-=sprite.scale.y*.35;
      return true;
    },
    sort,
    dispose() { clear(); fireball.dispose(); puffs.dispose(); flow.dispose(); noiseVolume.dispose(); },
    get active() { return puffs.active; },
    get shadowField() { return fireball.shadowField; },
    get diagnostics() { return {...flow.diagnostics,late:late?.state??null}; },
    get phase() {
      if (!timeline.length) return 'Ready';
      if (late) {
        if(late.state.cloudOpacity<=0)return 'Aftermath';
        if(late.state.cloudOpacity<1)return 'Cloud dispersing';
        return Math.abs(late.state.velocity)<1?'Cloud stabilized and spreading':'Buoyant cloud rising';
      }
      if (time < 1) return 'Flash and ground blast';
      if (time < 3.4) return 'Fireball and rising column';
      if (time < 15) return 'Mushroom cloud rolling';
      const columnEnd = DISSIPATION.baseEnd + DISSIPATION.columnSeconds;
      if (time < DISSIPATION.baseEnd) return 'Cloud drifting';
      if (time < columnEnd) return 'Column thinning';
      if (time < columnEnd + DISSIPATION.cloudSeconds) return 'Cloud dissipating';
      return 'Aftermath';
    },
  };
}
