import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateComponent } from './codegen.js';
import { defaultTokens } from './tokens.js';
import { auditMarkup, auditTokens } from '../audit/rules.js';
import type { ComponentType } from '../shared/types.js';

const ALL: ComponentType[] = ['hero', 'navbar', 'card', 'footer', 'features', 'testimonials', 'cta', 'pricing'];

test('default token set passes its own audit', () => {
  const findings = auditTokens(defaultTokens());
  assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
});

for (const type of ALL) {
  test(`generateComponent(${type}, html) is audit-clean`, () => {
    const { code, filename } = generateComponent(type, 'html', defaultTokens());
    assert.match(filename, new RegExp(`${type}\\.html$`));
    const findings = auditMarkup(code);
    assert.deepEqual(findings.map(f => f.ruleId), [], JSON.stringify(findings, null, 2));
  });
}

test('react output uses className and embeds the css', () => {
  const { code } = generateComponent('hero', 'react', defaultTokens());
  assert.match(code, /className=/);
  assert.doesNotMatch(code, / class="/);
  assert.match(code, /export function Hero/);
});
