import {createCloudSettings} from './cloud-settings.js';

// All fields below use the existing cloud algorithms. Finish editing to restart
// consistently, rather than mixing old births with new sizes or timing envelopes.
export function mountCloudControls(gui,{settings,scale,restart}) {
  const root=gui.addFolder('Cloud authoring · restarts blast').close();
  const finish=()=>{
    for(const object of Object.values(settings))for(const value of Object.values(object))
      if(Array.isArray(value))value.sort((a,b)=>a-b);
    settings.blend.detailEnd=Math.max(settings.blend.detailEnd,settings.blend.detailStart+.1);
    settings.feed.end=Math.max(settings.feed.end,settings.feed.taper+.1);
    settings.feed.columnEnd=Math.max(settings.feed.columnEnd,settings.feed.end+.1);
    settings.ringFormation.stop=Math.max(settings.ringFormation.stop,settings.ringFormation.buildEnd);
    settings.skirt.bottomRadius=Math.max(settings.skirt.bottomRadius,settings.skirt.topRadius);
    settings.skirt.bottomDrop=Math.max(settings.skirt.bottomDrop,settings.skirt.topDrop+.1);
    settings.skirt.revealEnd=Math.max(settings.skirt.revealEnd,settings.skirt.startAge+.5);
    settings.visibility.visibleSeconds=Math.max(settings.visibility.visibleSeconds,settings.visibility.fadeStart+1);
    root.controllersRecursive().forEach(c=>c.updateDisplay());restart();
  };
  const group=(name,key,fields)=>{
    const f=root.addFolder(name).close();
    for(const [path,label,min,max,step] of fields) {
      const [property,index]=path.split('.');
      const target=index===undefined?settings[key]:settings[key][property];
      f.add(target,index===undefined?property:index,min,max,step).name(label).onFinishChange(finish);
    }
  };
  root.add({reset(){
    const defaults=createCloudSettings(scale);
    for(const key of Object.keys(defaults))for(const [field,value] of Object.entries(defaults[key])) {
      if(Array.isArray(value))settings[key][field].splice(0,settings[key][field].length,...value);
      else settings[key][field]=value;
    }
    root.controllersRecursive().forEach(c=>c.updateDisplay());restart();
  }},'reset').name('Restore approved cloud defaults');
  group('Billows & growth','billows',[
    ['width','Billow width · ref m',6,30,.5],['variation','Width variation',0,.5,.01],
    ['grow','Mature growth gain',0,2,.05],['birthScale','Head birth scale',.25,2,.05],
  ]);
  group('Shared flow','shared',[['billowScale','Shared billow size ×',.5,2.5,.05],['headRoundness','Head shape support',0,1,.05]]);
  group('Skirt emission','skirt',[
    ['bursts','Skirt bursts',1,6,1],['parcels','Puffs per burst',3,12,1],
    ['interval','Burst interval · ref s',.2,4,.1],['startHeight','Legacy emission height · ref m',14,60,1],
    ['startAge','Skirt appears · ref s',.5,8,.5],['revealEnd','Skirt opens by · ref s',4,12,.5],
    ['follow','Skirt rise following ×',.3,1.3,.05],
    ['topRadius','Cone upper radius / head',.1,.7,.05],['bottomRadius','Cone lower radius / head',.3,1,.05],
    ['topDrop','Cone upper drop / head R',.2,1.2,.05],['bottomDrop','Cone lower drop / head R',.6,2.5,.05],
    ['puffScale','Skirt puff size ×',.3,1.3,.05],
  ]);
  group('Puff growth','growth',[
    ['birthScale','Skirt birth scale',.1,1.5,.05],['lateGain','Extra late growth',0,1,.05],
  ]);
  group('Puff blending','blend',[
    ['opticalDepth','Optical-depth boost',1,4,.1],['heatingSeconds','Heating smoothing · ref s',.05,2,.05],
    ['coolingSeconds','Cooling smoothing · ref s',.1,5,.1],['detailStart','Detail reveal start · ref s',0,10,.5],
    ['detailEnd','Detail reveal end · ref s',10.5,30,.5],['hold','Full-opacity life share',0,.95,.05],
  ]);
  group('Rolling','roll',[
    ['initial','Initial roll rate',.25,5,.05],['late','Residual roll rate',0,.5,.01],
    ['decay','Roll easing · ref s',1,60,1],['headGain','Head roll gain',-3,3,.1],['skirtGain','Skirt roll gain',-3,3,.1],
  ]);
  group('Puff counts · quality scaled','emission',[
    ['head','Head puffs',12,124,1],['fire','Early fire puffs',0,30,1],
    ['front','Front puffs',0,40,1],['mist','Mist puffs',0,24,1],
  ]);
  group('Ground dust','groundDust',[
    ['count','Residual puffs',4,26,1],['width.0','Inner width min · ref m',4,30,1],['width.1','Inner width max · ref m',4,50,1],
    ['edgeWidth.0','Outer width min · ref m',10,38,1],['edgeWidth.1','Outer width max · ref m',38,70,1],
    ['edgeSpeed.0','Spread speed min',0,1.6,.1],['edgeSpeed.1','Spread speed max',1.6,5,.1],
    ['edgeGrow','Outer growth gain',0,3,.1],['maxTop','Ground top cap · ref m',8,50,1],
    ['life.0','Life min · ref s',10,40,1],['life.1','Life max · ref s',40,100,1],
  ]);
  group('Ground ring','groundRing',[
    ['count','Ring puffs',8,36,1],['startRadius','Birth radius · ref m',2,20,1],
    ['radius.0','Reach min · ref m',25,65,1],['radius.1','Reach max · ref m',65,120,1],
    ['life.0','Life min · ref s',10,28,1],['life.1','Life max · ref s',28,80,1],['drag','Spread drag',.05,.8,.01],
  ]);
  group('Ring formation','ringFormation',[
    ['buildEnd','Build ends · ref s',2,10,.5],['stop','Footprint holds · ref s',10,24,.5],
  ]);
  group('Feed & ground settling','feed',[
    ['taper','Feed tapers · ref s',1,20,1],['end','Feed stops · ref s',21,40,1],
    ['columnEnd','Ground settles · ref s',41,120,1],
  ]);
  group('Late ascent','late',[
    ['entrainment','Entrainment',.05,.5,.01],['dilution','Density dilution exponent',.5,3,.1],
    ['takeoverSeconds','Force takeover · ref s',.5,20,.5],['riseFloor','Ascent pacing floor',.5,8,.1],
    ['diffusion','Late radial diffusion',0,20,.5],['windResponse','Bulk wind response',0,1,.01],
  ]);
  group('Column → skirt → cloud','lifecycle',[
    ['columnHold','Column holds until · ref s',40,180,5],
    ['columnFade','Column fade duration · ref s',5,120,5],
    ['skirtFade','Then skirt fade · ref s',5,120,5],
    ['groundHold','Ground dust holds · ref s',30,180,5],['groundFade','Ground dust settles · ref s',10,120,5],
  ]);
  group('Late atmosphere & visibility','visibility',[
    ['top','Cloud top target · m',1000,12000,100],['relativeHumidity','Relative humidity',.05,.95,.05],
    ['fadeStart','Fade begins · world s',300,3000,30],['visibleSeconds','Visibility ends · world s',600,7200,60],
    ['columnFadeSeconds','Legacy column fade · world s',10,360,10],
  ]);
  return root;
}
