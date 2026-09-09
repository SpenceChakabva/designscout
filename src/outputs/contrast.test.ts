import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  relativeLuminance,
  contrastRatio,
  classifyPair,
  suggestFix,
  auditTokenContrast,
  auditThemePair,
  extractColorPairsFromCss,
} from './contrast.js';
import type { DesignTokenSet } from '../shared/types.js';

const close = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps;
const tokens = (colors: Record<string, string>) => ({ colors } as unknown as DesignTokenSet);

test('contrastRatio: black on white is 21:1 across hex, shorthand, rgb() and named', () => {
  assert.ok(close(contrastRatio('#000000', '#ffffff'), 21));
  assert.ok(close(contrastRatio('#000', '#fff'), 21));
  assert.ok(close(contrastRatio('rgb(0,0,0)', 'white'), 21));
});

test('contrastRatio: #777 on #fff is ~4.48 — fails AA body, passes AA large', () => {
  const r = contrastRatio('#777777', '#ffffff');
  assert.ok(close(r, 4.48), `expected ~4.48, got ${r}`);
  const c = classifyPair('#777777', '#ffffff');
  assert.equal(c.AA, false);
  assert.equal(c.AALarge, true);
});

test('classifyPair: largeText relaxes the AA verdict to the 3.0 threshold', () => {
  assert.equal(classifyPair('#777777', '#ffffff', { largeText: true }).AA, true);
});

test('rgba() foreground is composited over the background before rating', () => {
  // 50% black over white ≈ #808080; ~3.95:1 on white.
  const r = contrastRatio('rgba(0,0,0,0.5)', '#ffffff');
  assert.ok(close(r, 3.95, 0.1), `expected ~3.95, got ${r}`);
});

test('known dark-theme failure: #555 on #1a1a1a fails AA (ratio < 3)', () => {
  const r = contrastRatio('#555555', '#1a1a1a');
  assert.ok(r < 3, `expected < 3, got ${r}`);
  assert.equal(classifyPair('#555555', '#1a1a1a').AA, false);
});

test('suggestFix output actually passes classifyPair at AA', () => {
  const fix = suggestFix('#555555', '#1a1a1a');
  assert.ok(fix, 'expected a fix');
  assert.equal(fix!.direction, 'lighter');
  assert.equal(classifyPair(fix!.fg, '#1a1a1a').AA, true);
});

test('unparseable colors throw and are recorded as skipped, not crashed on', () => {
  assert.throws(() => relativeLuminance('potato'));
  const report = auditTokenContrast(tokens({ foreground: 'potato', background: '#ffffff' }));
  assert.ok(report.skipped.some((s) => s.name === 'foreground/background'));
});

test('auditTokenContrast reports failures and the worst pair', () => {
  const report = auditTokenContrast(
    tokens({
      background: '#ffffff',
      foreground: '#111111',
      muted: '#ffffff',
      'muted-foreground': '#bbbbbb', // ~1.9:1 on white — clear failure
    }),
  );
  assert.ok(report.failures.some((f) => f.name === 'muted-foreground/background'));
  assert.equal(report.worst?.name, 'muted-foreground/background');
  const failed = report.failures.find((f) => f.name === 'muted-foreground/background')!;
  assert.ok(failed.fix && failed.fix.direction === 'darker');
});

test('auditThemePair catches a pair that passes light but fails dark', () => {
  const light = tokens({ background: '#ffffff', foreground: '#111111', 'muted-foreground': '#757575' });
  const dark = tokens({ background: '#111111', foreground: '#eeeeee', 'muted-foreground': '#757575' });
  const rep = auditThemePair(light, dark);
  const reg = rep.regressions.find((r) => r.name === 'muted-foreground/background');
  assert.ok(reg, 'expected a light↔dark regression for muted-foreground/background');
  assert.equal(reg!.failsIn, 'dark');
});

test('extractColorPairsFromCss pulls same-rule and var()-resolved custom-property pairs', () => {
  const css = `
    :root { --foreground: #0c1a16; --background: #ffffff; --muted-foreground: #48695e; --muted: #eef3f1; }
    .note { color: var(--muted-foreground); background: var(--muted); }
    .bad  { color: #999; background-color: #fff; }
  `;
  const { pairs } = extractColorPairsFromCss(css);
  assert.ok(pairs.some((p) => p.selector === '.bad' && p.fg === '#999999' && p.bg === '#ffffff'));
  assert.ok(pairs.some((p) => p.fg === '#48695e' && p.bg === '#eef3f1'));
});
