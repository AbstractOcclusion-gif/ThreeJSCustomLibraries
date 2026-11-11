import {onLeave} from '../kit/page-lifecycle.js';
import './mobile-controls.css';

// Reuse each page's controls and handlers; only the panel's visibility changes.
export function setupMobileControls(panel,button){
 const small=matchMedia('(max-width: 700px), (max-height: 500px)');
 const setOpen=open=>{panel.hidden=!open;button.textContent=open?'Hide controls':'Scene controls';button.setAttribute('aria-expanded',String(open));};
 button.onclick=()=>setOpen(panel.hidden);
 const change=()=>setOpen(!small.matches);
 small.addEventListener('change',change);change();
 const dispose=()=>{small.removeEventListener('change',change);button.onclick=null;};
 onLeave(dispose);
}

