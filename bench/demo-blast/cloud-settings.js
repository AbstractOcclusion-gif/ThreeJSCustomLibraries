import {CLOUD_BILLOWS} from './fire-look.js';
import {ROLL_MOTION} from './plume-motion.js';

// Authoring values, separate from numerical solver budgets owned by Quality.
// Each cloud gets its own mutable copy; these defaults reproduce the approved look.
export function createCloudSettings(scale) {
  return {
    billows:{...CLOUD_BILLOWS},
    shared:{billowScale:1.5},
    emission:{head:124,fire:30,front:40,mist:24},
    skirt:{bursts:4,parcels:8,interval:1.2,startHeight:26},
    growth:{birthScale:.32,lateGain:.35},
    blend:{opticalDepth:2,heatingSeconds:.22,coolingSeconds:1.8,detailStart:3,detailEnd:12,hold:.75},
    groundDust:{count:26,life:[40,52],width:[18,26],edgeWidth:[38,46],edgeSpeed:[1.6,2.1],edgeGrow:1.6,maxTop:26},
    groundRing:{count:36,startRadius:8,radius:[65,80],life:[28,42],drag:.18},
    ringFormation:{buildEnd:8,stop:12},
    feed:{taper:10,end:24,columnEnd:55},
    roll:{...ROLL_MOTION,headGain:-1.6,skirtGain:1.2},
    late:{entrainment:.22,dilution:1,takeoverSeconds:6,riseFloor:2,diffusion:8,windResponse:.15},
    visibility:{...(scale?.cloud??{top:3000,fadeStart:1200,visibleSeconds:1800,columnFadeSeconds:90,relativeHumidity:.45})},
  };
}
