import test from 'node:test';
import assert from 'node:assert/strict';
import {createSurfaceWeather, createWeatherSurfaceMaterial, createTrackMask} from '../../src/surface/index.js';

test('surface weather integrates precipitation into wetness/snow and the material binds it', () => {
 const weather = createSurfaceWeather();
 weather.set({wetness: 0, snow: 0});
 for (let i = 0; i < 60; i++) weather.update(.1, {rain: 1, snow: 0});
 const wet = weather.levels.value.x;
 assert.ok(wet > 0 && wet <= 1);
 const material = createWeatherSurfaceMaterial({color: 0x808080}, {weather});
 assert.ok(material.isMaterial);
 material.dispose();
});

test('track mask stamps inside its bounds only and clears', () => {
 const mask = createTrackMask({origin: [-10, -10], size: [20, 20], resolution: 64});
 mask.stamp({x: -5, z: 0}, {x: 5, z: 0}, .8, 1);
 const data = mask.texture.image.data;
 assert.ok(data.some(v => v > 0));
 mask.clear();
 assert.ok(data.every(v => v === 0));
 mask.stamp({x: 100, z: 100}, {x: 110, z: 100}, 1, 1);     // outside: no write, no throw
 assert.ok(data.every(v => v === 0));
 mask.dispose();
});
