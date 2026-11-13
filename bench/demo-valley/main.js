import {mountValley} from '../terrain/valley-main.js';
import {createValleyWaterView} from './water.js';

await mountValley({
  title: 'Valley with Pond and Lake',
  waterModes: ['Dry', 'Pond', 'Lake'],
  initialWater: 'Pond',
  waterLabel: 'Water body',
  createWaterView: createValleyWaterView,
});
