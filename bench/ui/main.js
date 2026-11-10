import {createBenchPanel} from '../panel.js';
import '../bench.css';

const defaults = {size: 96, angle: 20, color: '#e6be79', visible: true};
const state = {...defaults};
const shape = document.querySelector('.preview-shape');
const sizeLabel = document.querySelector('output');
function updatePreview() {
  shape.style.setProperty('--size', `${state.size}px`);
  shape.style.setProperty('--angle', `${state.angle}deg`);
  shape.style.setProperty('--color', state.color);
  shape.hidden = !state.visible;
  sizeLabel.value = `${state.size} px · ${state.angle}°`;
}
const preview = createBenchPanel('Preview controls').addFolder('Shape').close();
preview.add(state, 'size', 32, 180, 1).name('Shape size').onChange(updatePreview);
preview.add(state, 'angle', -180, 180, 1).name('Shape rotation').onChange(updatePreview);
preview.addColor(state, 'color').name('Shape color').onChange(updatePreview);
preview.add(state, 'visible').name('Show shape').onChange(updatePreview);
document.getElementById('reset').onclick = () => {
  Object.assign(state, defaults);
  preview.controllers.forEach(controller => controller.updateDisplay());
  updatePreview();
};
updatePreview();
