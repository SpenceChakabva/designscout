import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTokens, formatTokens } from './tokens.js';
import type { DesignPattern } from '../shared/types.js';

const patterns: DesignPattern[] = [
  {
    id: 'p1', siteId: 's1', category: 'color', subcategory: 'palette',
    data: { background: '#0c1a16', primary: '#c2683d', secondary: '#3d5c52', accent: '#e8b04a', textPrimary: '#f4f1ea', textSecondary: '#9a9387' },
    description: '', confidence: 0.9,
  },
  {
    id: 'p2', siteId: 's1', category: 'typography', subcategory: 'system',
    data: { headingStyle: 'serif', headingWeight: 'bold', bodyStyle: 'sans', estimatedScaleRatio: 1.333, notable: 'high contrast' },
    description: '', confidence: 0.8,
  },
  {
    id: 'p3', siteId: 's1', category: 'layout', subcategory: 'hero',
    data: { structure: 'centered', columns: 1, spacingDensity: 'spacious', maxWidth: 'medium' },
    description: '', confidence: 0.7,
  },
  {
    id: 'p4', siteId: 's1', category: 'mood', subcategory: 'editorial',
    data: { mood: 'editorial', signatureElements: ['oversized serif headline'] },
    description: '', confidence: 0.8,
  },
];

test('generateTokens uses the captured palette', () => {
  const t = generateTokens(patterns);
  assert.equal(t.colors.background, '#0c1a16');
  assert.equal(t.colors.primary, '#c2683d');
  assert.equal(t.colors.accent, '#e8b04a');
});

test('generateTokens builds a type scale from the ratio', () => {
  const t = generateTokens(patterns);
  assert.equal(t.typography.fontSizes.base, '1rem');
  assert.ok(parseFloat(t.typography.fontSizes['2xl']) > parseFloat(t.typography.fontSizes.lg));
});

test('generateTokens avoids overused font stacks', () => {
  const t = generateTokens(patterns);
  const stacks = Object.values(t.typography.fontFamilies).join(' ').toLowerCase();
  for (const bad of ['inter', 'roboto', 'geist', 'space grotesk']) {
    assert.ok(!stacks.includes(bad), `stack should not contain ${bad}`);
  }
});

test('css format emits custom properties', () => {
  const css = formatTokens({ ...generateTokens(patterns), id: '' }, 'css');
  assert.match(css, /--color-primary: #c2683d;/);
  assert.match(css, /:root \{/);
});

test('w3c format emits DTCG $type/$value', () => {
  const json = JSON.parse(formatTokens({ ...generateTokens(patterns), id: '' }, 'w3c'));
  assert.equal(json.color.primary.$type, 'color');
  assert.equal(json.color.primary.$value, '#c2683d');
});

test('style-dictionary format nests under value', () => {
  const json = JSON.parse(formatTokens({ ...generateTokens(patterns), id: '' }, 'style-dictionary'));
  assert.equal(json.color.primary.value, '#c2683d');
});

test('figma format produces a global set with tokenSetOrder', () => {
  const json = JSON.parse(formatTokens({ ...generateTokens(patterns), id: '' }, 'figma'));
  assert.equal(json.global.color.primary.type, 'color');
  assert.deepEqual(json.$metadata.tokenSetOrder, ['global']);
});
