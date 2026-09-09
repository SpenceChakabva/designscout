import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundleHtml } from './bundle.js';

test('addMeta inserts charset (first in head) and viewport when missing', async () => {
  const r = await bundleHtml(
    { html: '<html><head><title>x</title></head><body></body></html>' },
    { inlineImages: false },
  );
  assert.match(r.html, /<meta charset="utf-8">/i);
  assert.match(r.html, /<meta name="viewport" content="width=device-width, initial-scale=1">/i);
  assert.match(r.html, /<head>\s*<meta charset="utf-8">/i);
});

test('addMeta does not duplicate meta that already exists', async () => {
  const src =
    '<html><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>';
  const r = await bundleHtml({ html: src }, { inlineImages: false });
  assert.equal((r.html.match(/charset/gi) || []).length, 1);
  assert.equal((r.html.match(/name="viewport"/gi) || []).length, 1);
});

test('addMeta:false leaves the head untouched', async () => {
  const r = await bundleHtml(
    { html: '<html><head></head><body></body></html>' },
    { inlineImages: false, addMeta: false },
  );
  assert.doesNotMatch(r.html, /viewport/);
  assert.doesNotMatch(r.html, /charset/);
});

test('detects <img>, srcset and CSS url() refs and reports each asset', async () => {
  const src = `<html><head><style>
    .a { background: url("https://example.invalid/bg.png"); }
  </style></head><body>
    <img src="https://example.invalid/a.jpg">
    <img srcset="https://example.invalid/b.jpg 1x, https://example.invalid/c.jpg 2x">
  </body></html>`;

  // maxAssetBytes:1 forces skip on anything that does fetch; offline forces failed.
  const r = await bundleHtml({ html: src }, { inlineImages: true, maxAssetBytes: 1 });

  const urls = r.assets.map(a => a.url).sort();
  assert.deepEqual(urls, [
    'https://example.invalid/a.jpg',
    'https://example.invalid/b.jpg',
    'https://example.invalid/bg.png',
    'https://example.invalid/c.jpg',
  ]);
  // never throws; every asset is skipped or failed (host does not resolve)
  for (const a of r.assets) assert.ok(['skipped', 'failed'].includes(a.action), a.action);
});

test('oversized / unreachable asset is reported, not thrown', async () => {
  const r = await bundleHtml(
    { html: '<body><img src="https://example.invalid/huge.png"></body>' },
    { inlineImages: true, maxAssetBytes: 10 },
  );
  assert.equal(r.assets.length, 1);
  assert.ok(['skipped', 'failed'].includes(r.assets[0].action));
  assert.ok(r.assets[0].reason);
});

test('relative refs need a baseUrl, absolute data: URIs are left alone', async () => {
  const src = '<body><img src="./local.png"><img src="data:image/gif;base64,AAAA"></body>';
  const r = await bundleHtml({ html: src }, { inlineImages: true });
  // no baseUrl -> ./local.png is unresolvable, no asset recorded; data: URI ignored
  assert.deepEqual(r.assets, []);
  assert.match(r.html, /data:image\/gif/);
});

test('reports originalBytes and bytes', async () => {
  const src = '<html><head></head><body>hi</body></html>';
  const r = await bundleHtml({ html: src }, { inlineImages: false });
  assert.equal(r.originalBytes, Buffer.byteLength(src, 'utf-8'));
  assert.ok(r.bytes >= r.originalBytes); // addMeta only grows it
});

test('cross-origin <script src> outside the allowlist is not inlined', async () => {
  const src = '<body><script src="https://evil.example.invalid/x.js"></script></body>';
  const r = await bundleHtml({ html: src }, { inlineImages: false, inlineScripts: true });
  assert.match(r.html, /evil\.example\.invalid\/x\.js/);
  assert.ok(r.warnings.some(w => /allowlist/.test(w)));
});

// One real network test — skips cleanly when offline.
test('inlines a real allowlisted script (network)', async (t) => {
  const src =
    '<html><head></head><body>' +
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/gsap.min.js"></script>' +
    '</body></html>';
  let r;
  try {
    r = await bundleHtml({ html: src }, { inlineImages: false, inlineScripts: true });
  } catch (err) {
    t.skip(`network error: ${(err as Error).message}`);
    return;
  }
  const asset = r.assets.find(a => a.type === 'script');
  if (!asset || asset.action !== 'inlined') {
    t.skip('network unavailable');
    return;
  }
  assert.doesNotMatch(r.html, /<script src=/i);
  assert.match(r.html, /gsap/i);
  assert.ok(r.bytes > r.originalBytes);
});
