import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyOutput, checkInlineScripts } from './verify.js';
import { getConfig } from '../shared/config.js';

const config = getConfig();

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-verify-'));

function fixture(name: string, html: string): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, html, 'utf-8');
  return p;
}

const CLEAN = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Clean</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, sans-serif; font-size: 16px; }
    main { max-width: 800px; margin: 0 auto; padding: 24px; }
    button { min-height: 48px; min-width: 48px; padding: 12px 20px; font-size: 16px; }
    p { font-size: 16px; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>A responsive page</h1>
    <p>This paragraph wraps normally and does not push the layout sideways on any device.</p>
    <button type="button">Continue</button>
  </main>
</body>
</html>`;

const OVERFLOW = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Overflow</title>
  <style>body { margin: 0; } .wide { width: 2000px; height: 80px; background: #333; }</style>
</head>
<body>
  <div class="wide">a fixed 2000px-wide block</div>
  <p>content below</p>
</body>
</html>`;

const NO_META = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>No meta</title>
  <style>body { margin: 0; font-size: 16px; } main { max-width: 700px; margin: 0 auto; }</style>
</head>
<body>
  <main><h1>Missing viewport meta and lang</h1><p>Body text here for the check.</p></main>
</body>
</html>`;

const TINY_TAP = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tiny tap</title>
  <style>
    body { margin: 0; font-size: 16px; }
    a.mini { display: inline-block; width: 20px; height: 20px; line-height: 20px; background: #eee; text-align: center; }
  </style>
</head>
<body>
  <main>
    <h1>Tiny tap target</h1>
    <a class="mini" href="#x">x</a>
  </main>
</body>
</html>`;

const BAD_SCRIPT = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bad JS</title></head>
<body>
  <h1>Broken inline script</h1>
  <script>function () { return ;;; oops(( }</script>
</body>
</html>`;

let chromiumOk = true;
try {
  // Cheap probe: a clean fixture should verify without throwing a launch error.
  await verifyOutput({ filePath: fixture('probe.html', CLEAN), viewports: [config.viewportPresets.mobile] }, config);
} catch (err) {
  const msg = (err as Error).message || '';
  if (/Executable doesn't exist|Failed to launch|browserType\.launch|install/i.test(msg)) {
    chromiumOk = false;
  }
}

test('clean responsive page passes', async (t) => {
  if (!chromiumOk) return t.skip('Chromium not installed');
  const report = await verifyOutput({ filePath: fixture('clean.html', CLEAN) }, config);
  assert.equal(report.ok, true, JSON.stringify(report.summary));
  assert.equal(report.summary.horizontalScrollViewports.length, 0);
  assert.equal(report.global.hasViewportMeta, true);
  assert.equal(report.global.hasLang, true);
  assert.equal(report.syntaxErrors.length, 0);
});

test('fixed 2000px-wide div flags horizontal overflow on mobile', async (t) => {
  if (!chromiumOk) return t.skip('Chromium not installed');
  const report = await verifyOutput({ filePath: fixture('overflow.html', OVERFLOW) }, config);
  assert.equal(report.ok, false);
  assert.ok(report.summary.horizontalScrollViewports.includes('mobile'));
  const mobile = report.viewportResults.find(v => v.viewport === 'mobile')!;
  assert.equal(mobile.horizontalScroll, true);
  assert.ok(mobile.overflowElements.some(e => e.selector.includes('wide')));
});

test('missing viewport meta and lang are reported (viewport-independent)', async (t) => {
  if (!chromiumOk) return t.skip('Chromium not installed');
  const report = await verifyOutput({ filePath: fixture('nometa.html', NO_META) }, config);
  assert.equal(report.global.hasViewportMeta, false);
  assert.equal(report.global.hasLang, false);
  assert.equal(report.global.hasCharset, true);
  assert.equal(report.summary.missingViewportMeta, true);
  assert.equal(report.ok, false);
});

test('20px tap target is flagged below 44x44', async (t) => {
  if (!chromiumOk) return t.skip('Chromium not installed');
  const report = await verifyOutput({ filePath: fixture('tinytap.html', TINY_TAP) }, config);
  const mobile = report.viewportResults.find(v => v.viewport === 'mobile')!;
  assert.ok(mobile.tapTargets.length >= 1);
  assert.ok(mobile.tapTargets.some(t2 => t2.width < 44 && t2.selector.includes('a')));
});

test('inline <script> syntax error is caught (works without a browser)', () => {
  const errs = checkInlineScripts(BAD_SCRIPT);
  assert.ok(errs.length >= 1);
  assert.equal(errs[0].scriptIndex, 1);
});

test('checkInlineScripts skips module and json-ld scripts', () => {
  const markup = `
    <script type="module">import x from './y.js'; export const z = 1;</script>
    <script type="application/ld+json">{ "@context": "https://schema.org" }</script>
    <script src="/app.js"></script>
    <script>const a = 1;</script>`;
  assert.equal(checkInlineScripts(markup).length, 0);
});
