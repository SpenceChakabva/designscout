import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDeps } from './deps.js';

test('resolveDeps returns one result per lib with the right shape', async () => {
  const results = await resolveDeps(['gsap']);
  assert.equal(results.length, 1);
  const r = results[0];
  assert.equal(r.requested, 'gsap');
  assert.equal(r.name, 'gsap');
  assert.ok(['cdnjs', 'jsdelivr', 'unresolved'].includes(r.source));
  assert.ok('version' in r && 'url' in r && 'notes' in r);
  if (r.source === 'unresolved') {
    assert.equal(r.version, null);
    assert.equal(r.url, null);
    assert.match(r.notes, /network|not found/i);
  } else {
    assert.ok(r.version);
    assert.match(r.url ?? '', /^https:\/\//);
  }
});

test('gsap/ScrollTrigger alias maps to the gsap package + ScrollTrigger file', async () => {
  const [r] = await resolveDeps(['gsap/ScrollTrigger']);
  assert.equal(r.requested, 'gsap/ScrollTrigger');
  assert.equal(r.name, 'gsap');
  assert.match(r.notes, /ScrollTrigger is part of the gsap package/);
  if (r.source !== 'unresolved') {
    assert.match(r.url ?? '', /ScrollTrigger\.min\.js$/);
  }
});

test('lenis alias is documented and resolves via jsdelivr or is unresolved offline', async () => {
  const [r] = await resolveDeps(['lenis']);
  assert.equal(r.name, 'lenis');
  assert.match(r.notes, /cdnjs/i);
  if (r.source === 'unresolved') {
    assert.equal(r.version, null);
    assert.match(r.notes, /network|not found/i);
  } else {
    assert.equal(r.source, 'jsdelivr');
    assert.match(r.url ?? '', /cdn\.jsdelivr\.net\/npm\/lenis@/);
  }
});

test('unknown lib gets a guessed jsdelivr path with a verify note, or unresolved', async () => {
  const [r] = await resolveDeps(['definitely-not-a-real-lib-xyz-123']);
  assert.equal(r.requested, 'definitely-not-a-real-lib-xyz-123');
  assert.ok(['jsdelivr', 'unresolved'].includes(r.source));
});

test('prefer:jsdelivr is accepted', async () => {
  const results = await resolveDeps(['gsap'], { prefer: 'jsdelivr' });
  assert.equal(results.length, 1);
  assert.ok(['cdnjs', 'jsdelivr', 'unresolved'].includes(results[0].source));
});
