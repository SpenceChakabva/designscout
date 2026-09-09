import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateMotionLayer,
  describeDetected,
  MOTION_EFFECTS,
  type MotionEffect,
  type MotionLayerOptions,
} from './motion.js';
import type { DesignPattern } from '../shared/types.js';

const ALL: MotionEffect[] = [...MOTION_EFFECTS];

test('vanilla output carries no GSAP references', () => {
  const r = generateMotionLayer({ library: 'none', effects: ALL, smoothScroll: true, themeTransition: 'iris' });
  assert.doesNotMatch(r.js, /gsap/i);
  assert.doesNotMatch(r.js, /scrolltrigger/i);
  assert.doesNotMatch(r.js, /lenis/i);
  assert.doesNotMatch(r.css, /gsap/i);
  assert.doesNotMatch(r.html, /gsap/i);
});

test('both builds carry the reduced-motion guard and the .anim-ready gate', () => {
  for (const library of ['none', 'gsap'] as const) {
    const r = generateMotionLayer({ library, effects: ALL });
    assert.match(r.js, /prefers-reduced-motion/, `${library}: js missing reduced-motion guard`);
    assert.match(r.js, /reduced\s*=\s*matchMedia/, `${library}: js missing matchMedia read`);
    assert.match(r.js, /anim-ready/, `${library}: js missing anim-ready gate`);
    assert.match(r.js, /classList\.add\('anim-ready'\)/, `${library}: js never adds anim-ready`);
    assert.match(r.js, /showAllAtRest\(\);\s*return;/, `${library}: js does not bail to final state`);
  }
});

test('gsap build gates on window.gsap before adding anim-ready', () => {
  const r = generateMotionLayer({ library: 'gsap', effects: ALL });
  assert.match(r.js, /window\.gsap && window\.ScrollTrigger/);
  assert.match(r.js, /if \(reduced \|\| !hasGsap\) \{ showAllAtRest\(\); return; \}/);
});

test('gsap + smoothScroll pulls in a window.gsap guard and Lenis', () => {
  const r = generateMotionLayer({ library: 'gsap', effects: ['reveal'], smoothScroll: true });
  assert.match(r.js, /window\.gsap/);
  assert.match(r.js, /Lenis/);
  assert.match(r.js, /new window\.Lenis/);
});

test('smoothScroll is dropped on the vanilla build', () => {
  const r = generateMotionLayer({ library: 'none', effects: ['reveal'], smoothScroll: true });
  assert.doesNotMatch(r.js, /Lenis/i);
  assert.ok(r.notes.some(n => /smooth_scroll was ignored/i.test(n)));
});

test('css always carries the reduced-motion kill-switch', () => {
  for (const opts of [
    { library: 'none' as const, effects: ['reveal'] as MotionEffect[] },
    { library: 'gsap' as const, effects: ALL },
    { library: 'none' as const, effects: ['marquee'] as MotionEffect[], themeTransition: 'wipe' as const },
  ]) {
    const r = generateMotionLayer(opts);
    assert.match(r.css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(r.css, /anim-ready/);
  }
});

test('theme transitions use the View Transitions API behind a support check', () => {
  for (const themeTransition of ['fade', 'iris', 'wipe'] as const) {
    const r = generateMotionLayer({ library: 'none', effects: ['reveal'], themeTransition });
    assert.match(r.js, /typeof document\.startViewTransition !== 'function'/);
    assert.match(r.js, /document\.startViewTransition\(applyTheme\)/);
    assert.match(r.css, /::view-transition/);
  }
});

test('emitted js is syntactically valid across option combinations', () => {
  const combos: MotionLayerOptions[] = [
    {},
    { library: 'none', effects: ALL },
    { library: 'gsap', effects: ALL, smoothScroll: true, themeTransition: 'iris' },
    { library: 'gsap', effects: ['parallax', 'count-up', 'marquee'], themeTransition: 'wipe' },
    { library: 'none', effects: ['line-mask', 'magnetic', 'blur-in'], themeTransition: 'fade' },
    { library: 'none', effects: [] as MotionEffect[] },
    { library: 'gsap', effects: ['reveal'], smoothScroll: false },
  ];
  for (const combo of combos) {
    const r = generateMotionLayer(combo);
    assert.doesNotThrow(() => new Function(r.js), `combo ${JSON.stringify(combo)} produced invalid js`);
    assert.ok(r.effects.length >= 1);
    assert.ok(r.effects.every(e => (MOTION_EFFECTS as string[]).includes(e)));
  }
});

test('generateMotionLayer falls back to reveal when no effects resolve', () => {
  const r = generateMotionLayer({ effects: [] as MotionEffect[] });
  assert.deepEqual(r.effects, ['reveal']);
});

test('describeDetected reads GSAP + Lenis + scroll signals from stored patterns', () => {
  const patterns: DesignPattern[] = [
    {
      id: 'a1', siteId: 's1', category: 'mood', subcategory: 'editorial',
      data: {
        libraries: ['GSAP', 'GSAP ScrollTrigger', 'Lenis'],
        scrollTriggered: true,
        transitions: [{ selector: 'h1', property: 'transform', duration: '0.9s', easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }],
        keyframes: [{ name: 'marquee', properties: ['transform'] }],
        signatureElements: ['infinite marquee strip', 'oversized serif headline', 'parallax hero image'],
      },
      description: 'Heavy scroll animation, count-up stats, magnetic buttons',
      confidence: 0.8,
    },
  ];
  const d = describeDetected(patterns);
  assert.equal(d.suggestedLibrary, 'gsap');
  assert.ok(d.smoothScroll);
  assert.ok(d.scrollTriggered);
  assert.ok(d.libraries.includes('GSAP'));
  assert.ok(d.easings.some(e => e.includes('cubic-bezier')));
  assert.ok(d.keyframeNames.includes('marquee'));
  for (const e of ['reveal', 'stagger', 'parallax', 'marquee', 'count-up', 'line-mask', 'magnetic'] as MotionEffect[]) {
    assert.ok(d.suggestedEffects.includes(e), `expected ${e} in suggested effects`);
  }
});

test('describeDetected is defensive against empty / odd pattern data', () => {
  const d0 = describeDetected([]);
  assert.equal(d0.suggestedLibrary, 'none');
  assert.deepEqual(d0.suggestedEffects, ['reveal', 'stagger']);

  const weird: DesignPattern[] = [
    { id: 'x', siteId: 's', category: 'color', subcategory: 'palette', data: { nested: { deep: [1, 2, null] }, background: '#000' }, description: '', confidence: 0.5 },
  ];
  const d1 = describeDetected(weird);
  assert.equal(d1.suggestedLibrary, 'none');
  assert.ok(Array.isArray(d1.suggestedEffects));
});

test('detected summary drives defaults when no explicit options given', () => {
  const detected = describeDetected([
    {
      id: 'p', siteId: 's', category: 'mood', subcategory: 'techy',
      data: { libraries: ['GSAP'], scrollTriggered: true, signatureElements: ['count-up metrics'] },
      description: '', confidence: 0.8,
    },
  ]);
  const r = generateMotionLayer({ detected });
  assert.match(r.js, /window\.gsap/);
  assert.ok(r.effects.includes('parallax'));
  assert.ok(r.effects.includes('count-up'));
});
