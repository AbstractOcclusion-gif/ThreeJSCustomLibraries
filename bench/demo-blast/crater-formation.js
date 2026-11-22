export const CRATER_FORMATION = Object.freeze({delay:.12,duration:1.4,stages:28});

// Shallow nested excavations through the existing terrain API. Depth increments
// sum to the configured centre depth; replaying frames cannot dig it twice.
export function createCraterFormation(crater,stamp) {
  let completed=0,depthShare=0;
  return {
    advance(referenceTime) {
      const phase=Math.max(0,Math.min(1,(referenceTime-CRATER_FORMATION.delay)/CRATER_FORMATION.duration));
      const target=Math.min(CRATER_FORMATION.stages,Math.floor(phase*CRATER_FORMATION.stages+1e-8));
      let changed=false;
      while(completed<target) {
        const t=++completed/CRATER_FORMATION.stages;
        const share=t*t*(3-2*t);
        const result=stamp({radius:crater.radius*share,depth:crater.depth*(share-depthShare),last:completed===CRATER_FORMATION.stages});
        changed=Boolean(result)||changed;
        depthShare=share;
      }
      return changed;
    },
    reset(){completed=0;depthShare=0;},
    get complete(){return completed===CRATER_FORMATION.stages;},
  };
}
