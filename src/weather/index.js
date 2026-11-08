import {Weather} from './weather.js';
import {DayCycle} from './day.js';
export {Weather} from './weather.js';
export {DayCycle,DAY_DEFAULTS,hourLabel} from './day.js';
export {DEFAULT_WEATHER_STATES,defineWeatherStates,WEATHER_FIELDS} from './states.js';

export function createWeatherSystem({weather={},day={},onEvent}={}){
 const listeners=new Set();if(onEvent)listeners.add(onEvent);const emit=e=>{for(const listener of listeners)listener(e);};
 const state=new Weather({...weather,onEvent:emit}),clock=new DayCycle({...day,onEvent:emit});
 return{weather:state,day:clock,paused:false,subscribe(listener){if(typeof listener!=='function')throw Error('Weather-system listener must be a function');listeners.add(listener);return()=>listeners.delete(listener);},
  update(dt){if(!Number.isFinite(dt)||dt<0)throw Error('System dt must be finite and non-negative');state.update(this.paused?0:dt);clock.update(this.paused?0:dt);return this;},
  save(){return{type:'weather-system',version:1,paused:this.paused,weather:state.save(),day:clock.save()};},
  restore(data){
   if(data?.type!=='weather-system'||data.version!==1)throw Error('Unsupported weather-system snapshot');
   // Validate both branches before mutating either live system.
   new Weather({states:state.states}).restore(data.weather);new DayCycle().restore(data.day);
   state.restore(data.weather);clock.restore(data.day);this.paused=!!data.paused;return this;
  },
 };
}
