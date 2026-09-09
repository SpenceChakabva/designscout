import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { buildPreGenChecklist } from './checklist.js';

test('checklist always covers the seven decision areas', () => {
  const c = buildPreGenChecklist('https://example.com', null, []);
  assert.deepEqual(
    c.items.map(i => i.key).sort(),
    ['bundling', 'fonts', 'forms', 'imagery', 'motion', 'responsive', 'theming'],
  );
});

test('detects motion from the reference animation libraries', () => {
  const c = buildPreGenChecklist(
    'https://example.com',
    { animations: { libraries: ['GSAP', 'Lenis'], scrollTriggered: true } },
    [],
  );
  const motion = c.items.find(i => i.key === 'motion')!;
  assert.match(motion.referenceSignal, /GSAP/);
  assert.match(motion.recommendation, /scout_motion/);
});

test('recommends both themes when the reference uses prefers-color-scheme', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-checklist-'));
  const htmlPath = path.join(dir, 'page.html');
  fs.writeFileSync(htmlPath, '<html><head><style>@media (prefers-color-scheme: dark){body{color:#fff}}</style></head><body><form></form></body></html>');

  const c = buildPreGenChecklist('https://example.com', {}, [], htmlPath);
  const theming = c.items.find(i => i.key === 'theming')!;
  const forms = c.items.find(i => i.key === 'forms')!;
  assert.match(theming.recommendation, /Ship both themes/);
  assert.match(forms.recommendation, /accessible <form>/);
});

test('static reference does not push a motion layer', () => {
  const c = buildPreGenChecklist('https://example.com', { animations: { libraries: [] } }, []);
  const motion = c.items.find(i => i.key === 'motion')!;
  assert.match(motion.recommendation, /Static is faithful/);
});
