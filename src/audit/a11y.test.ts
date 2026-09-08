import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAccessibilityReport, summarizeA11y } from './a11y.js';
import type { RawA11y } from '../browser/extract.js';

const clean: RawA11y = { issues: [], headingOutline: [{ level: 1, text: 'Title' }], landmarks: ['main', 'navigation'] };

test('a clean scan scores 100', () => {
  const report = buildAccessibilityReport('s1', clean);
  assert.equal(report.score, 100);
  assert.match(summarizeA11y(report), /100\/100/);
});

test('errors drop the score and sort first', () => {
  const raw: RawA11y = {
    issues: [
      { rule: 'img-alt', severity: 'error', detail: 'x', count: 4, selectorSample: [] },
      { rule: 'html-lang', severity: 'warning', detail: 'y', count: 1, selectorSample: [] },
    ],
    headingOutline: [], landmarks: [],
  };
  const report = buildAccessibilityReport('s1', raw);
  assert.ok(report.score < 100);
  assert.equal(report.issues[0].severity, 'error');
});

test('score is clamped to 0', () => {
  const raw: RawA11y = {
    issues: Array.from({ length: 20 }, (_, i) => ({
      rule: `r${i}`, severity: 'error' as const, detail: 'x', count: 10, selectorSample: [],
    })),
    headingOutline: [], landmarks: [],
  };
  assert.equal(buildAccessibilityReport('s1', raw).score, 0);
});
