import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseViewport, resolveViewport, deviceForWidth, VIEWPORT_PRESETS } from './config.js';

test('parseViewport handles WxH and rejects junk', () => {
  assert.deepEqual(parseViewport('1440x900'), { width: 1440, height: 900 });
  assert.deepEqual(parseViewport('390 X 844'), { width: 390, height: 844 });
  assert.equal(parseViewport('wide'), null);
  assert.equal(parseViewport(undefined), null);
});

test('resolveViewport maps device keywords', () => {
  assert.equal(resolveViewport('mobile').width, VIEWPORT_PRESETS.mobile.width);
  assert.equal(resolveViewport('tablet').device, 'tablet');
  assert.equal(resolveViewport('desktop').label, 'desktop');
});

test('resolveViewport parses explicit sizes and infers device', () => {
  const vp = resolveViewport('375x812');
  assert.equal(vp.width, 375);
  assert.equal(vp.device, 'mobile');
});

test('resolveViewport falls back to desktop on garbage', () => {
  assert.equal(resolveViewport('!!!').label, 'desktop');
});

test('deviceForWidth boundaries', () => {
  assert.equal(deviceForWidth(390), 'mobile');
  assert.equal(deviceForWidth(834), 'tablet');
  assert.equal(deviceForWidth(1440), 'desktop');
});
