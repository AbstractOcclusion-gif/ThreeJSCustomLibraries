// Bulk entraining thermal in a stably stratified atmosphere. Metres / seconds.
// The fine grid supplies the initial shape; this model transports that shape.
// Neutral height and visible lifetime are atmosphere-dependent reference presets,
// not yield-only predictions. No radiation/fallout quantities are calculated.
const VOLUME = 4 * Math.PI / 3;
// Exponent of the gas density's fall with the cloud's linear expansion. 3 conserves
// the aerosol: optical depth then falls with the square and the cloud is haze within
// a minute. 1 holds the optical depth, standing for the dust and moisture the thermal
// keeps entraining; the visibility presets own the final fade.
const smooth = (a,b,x) => { const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t); };
const saturation = (temperature,pressure) => {
  const c=temperature-273.15, vapor=611.2*Math.exp(17.67*c/(c+243.5));
  return .622*vapor/(pressure-vapor);
};

export function createLateCloud(scale, head, startTime = 0, settings = {}) {
  const {entrainment:ENTRAINMENT=.22,dilution:DILUTION=1,takeoverSeconds=6,riseFloor=2,diffusion=8,windResponse=.15}=settings;
  const profile = {...scale.cloud,...settings.profile};
  const z0 = head.height * scale.length, r0 = head.radius * scale.length;
  const referenceJoin = Math.max(8, head.height - head.radius * 1.35);
  // Integrating N² V dz gives the buoyancy lost through displacement. Choose
  // stratification so the reference thermal is neutral at the intended top.
  const neutral = (profile.top - r0 + ENTRAINMENT*z0)/(1+ENTRAINMENT);
  const reach = Math.max(1, neutral-z0);
  const rNeutral = r0 + ENTRAINMENT*reach;
  const volumeIntegral = VOLUME*(rNeutral**4-r0**4)/(4*ENTRAINMENT);
  // Retained thermal energy after early entrainment: deliberately a model setting.
  const initialBuoyancy = 9.81 * .24 * 4.184e12 * scale.yieldKt / (1.225*1005*293);
  const stratification = initialBuoyancy / volumeIntegral;
  const humidity=profile.relativeHumidity;
  const vapor=humidity*saturation(293,101325);
  const gamma=Math.log(humidity)+17.67*(293-273.15)/(293-29.65);
  const dewpoint=243.5*gamma/(17.67-gamma);
  const liftingLevel=125*((293-273.15)-dewpoint);
  const inheritedRise=(head.rise??8)*scale.length/scale.seconds;
  const riseLimit=head.rise===undefined?Infinity:Math.max(Math.abs(inheritedRise),riseFloor*scale.length/scale.seconds);
  let z=z0, radius=r0, velocity=inheritedRise, buoyancy=initialBuoyancy;
  let elapsed=0, driftX=0, driftZ=0, columnFadeAge=null, settled=false;
  const state = {
    height:z, radius, velocity, elapsed, settled, referenceHeight:head.height, referenceJoin,
    head:z/scale.length, expansion:1, wind:[0,0],
    offset:head.offset??[0,0],
    cloudOpacity:1, columnOpacity:1, heat:1, density:1,liquidExtinction:0,
  };
  return {
    state,
    update(dt, wind) {
      // The bulk solve costs a handful of scalar operations, independent of grid.
      for (let remaining=dt;remaining>1e-9;) {
        const step=Math.min(.25,remaining);remaining-=step;
        const volume=VOLUME*radius**3;
        const entrain=ENTRAINMENT*Math.max(0,velocity);
        // Continue the measured plume speed, then introduce the bulk model's
        // forces smoothly. No preset velocity jump when the phase label changes.
        const takeover=head.rise===undefined?1:smooth(0,takeoverSeconds*scale.seconds,elapsed);
        let acceleration=(buoyancy/volume - (3*entrain/radius)*velocity
          - .4*velocity*Math.abs(velocity)/radius - .5*Math.sqrt(stratification)*velocity)*takeover;
        // Authored pacing: remove the second rapid acceleration after takeover.
        // Negative acceleration remains free to brake and stabilize the cloud.
        if(acceleration>0)acceleration*=Math.max(0,1-(Math.max(0,velocity)/riseLimit)**2);
        velocity=settled?0:velocity+acceleration*step;
        const displacement=velocity*step;
        z+=displacement;
        buoyancy-=stratification*volume*displacement;
        // Lateral turbulent diffusion continues after vertical motion dies away.
        radius+=entrain*step + diffusion/radius*step;
        elapsed+=step;
        if(!settled && z+radius>=profile.top*.9 && Math.abs(velocity)<1) {
          settled=true;velocity=0;buoyancy=0;
        }
        if(columnFadeAge===null && z+radius>=profile.top*.9 && Math.abs(velocity)<3
          && elapsed+startTime>55.5*scale.seconds) columnFadeAge=elapsed+startTime;
        driftX+=(wind?.x??0)*step*windResponse;driftZ+=(wind?.z??0)*step*windResponse;
      }
      const expansion=radius/r0;
      // Dry ascent to the lifting condensation level, then a moist lapse rate.
      // Humidity is an explicit standard-atmosphere assumption, not live weather.
      const temperature=293-.0098*Math.min(z,liftingLevel)-.006*Math.max(0,z-liftingLevel)+80*Math.exp(-elapsed/50);
      const pressure=101325*Math.exp(-z/8400);
      const liquid=.25*Math.max(0,vapor-saturation(temperature,pressure));
      const waterContent=Math.min(.001,liquid)*1.225*Math.exp(-z/8400);
      // Extinction of 12 micron droplets: 3 LWC / (2 rhoWater rDrop).
      const liquidExtinction=3*waterContent/(2*1000*12e-6);
      Object.assign(state, {height:z,radius,velocity,elapsed,settled,head:z/scale.length,expansion,
        cloudOpacity:1-smooth(profile.fadeStart,profile.visibleSeconds,elapsed+startTime),
        columnOpacity:columnFadeAge===null?1:1-smooth(columnFadeAge,columnFadeAge+profile.columnFadeSeconds,elapsed+startTime),
        heat:Math.exp(-elapsed/35),density:1/expansion**DILUTION,liquidExtinction});
      state.wind[0]=driftX/scale.length;state.wind[1]=driftZ/scale.length;
      return state;
    },
  };
}

// Exact counterpart of the shader's inverse map. Only the stem stretches;
// the cap and attached skirt expand uniformly about the head centre.
export function mapLatePoint(out, point, origin, size, state) {
  const y=(point.y-origin.y)/size, join=state.referenceJoin;
  const newJoin=state.head+(join-state.referenceHeight)*state.expansion;
  const anchor=Math.min(12,join*.5);
  const share=Math.max(0,Math.min(1,y/join));
  const radial=1+(state.expansion-1)*share;
  const height=y<=anchor ? y : y<join ? anchor+(y-anchor)*(newJoin-anchor)/(join-anchor)
    : state.head+(y-state.referenceHeight)*state.expansion;
  return out.set(origin.x+(point.x-origin.x)*radial+state.wind[0]*size*share,
    origin.y+height*size,origin.z+(point.z-origin.z)*radial+state.wind[1]*size*share);
}
