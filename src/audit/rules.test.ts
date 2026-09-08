import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAudit, auditCopy, auditTokens, auditExtraction, auditMarkup, extractTextFromHtml, RULES } from './rules.js';

test('flags overused fonts', () => {
  const findings = runAudit({ fonts: ['Inter', 'DM Sans'] });
  assert.ok(findings.some(f => f.ruleId === 'overused-font' && f.snippet === 'Inter'));
  assert.ok(!findings.some(f => f.snippet === 'DM Sans'));
});

test('flags pure gray and pure black', () => {
  const findings = runAudit({ colors: ['#808080', '#000000'] });
  assert.ok(findings.some(f => f.ruleId === 'pure-gray'));
  assert.ok(findings.some(f => f.ruleId === 'pure-black'));
});

test('flags a purple palette', () => {
  const findings = runAudit({ colors: ['#7c3aed', '#8b5cf6', '#a78bfa'] });
  assert.ok(findings.some(f => f.ruleId === 'ai-purple-palette'));
});

test('flags gradient text and glassmorphism in CSS', () => {
  const css = '.h { background: linear-gradient(90deg,#f0f,#0ff); background-clip: text; } .p { backdrop-filter: blur(12px); background: rgba(255,255,255,0.4); }';
  const findings = runAudit({ css });
  assert.ok(findings.some(f => f.ruleId === 'gradient-text'));
  assert.ok(findings.some(f => f.ruleId === 'glassmorphism'));
});

test('flags stacked 100vh sections', () => {
  const css = '.a{min-height:100vh}.b{height:100vh}.c{min-height:100dvh}';
  assert.ok(runAudit({ css }).some(f => f.ruleId === 'full-viewport-sections'));
});

test('flags icon-tile-above-heading pattern', () => {
  const block = '<div class="feature-icon"><svg viewBox="0 0 24 24"><path d="M1 1"/></svg></div><h3>Fast</h3>';
  const html = block.repeat(3);
  assert.ok(runAudit({ html }).some(f => f.ruleId === 'icon-tile-heading'));
});

test('copy audit catches em-dash density and filler phrases', () => {
  const text = 'We leverage cutting-edge tech to elevate your workflow — seamlessly — effortlessly — '.repeat(3);
  const findings = auditCopy(text);
  assert.ok(findings.some(f => f.ruleId === 'em-dash-overuse'));
  assert.ok(findings.some(f => f.ruleId === 'ai-copy-phrase'));
});

test('clean input produces no findings', () => {
  const findings = runAudit({
    colors: ['#0c1a16', '#f4f1ea', '#c2683d'],
    fonts: ['Satoshi', 'Literata'],
    css: '.btn { border-radius: 4px; transition: opacity .2s ease-out; }',
    text: 'DesignScout runs a headless browser and stores what it finds. That is the whole tool.',
  });
  assert.equal(findings.length, 0);
});

test('auditTokens tints derived grays so it does not flag its own output', () => {
  const findings = auditTokens({
    colors: { background: '#ffffff', foreground: '#141310', primary: '#c2683d', muted: '#8a8377' },
    typography: { fontFamilies: { body: "'DM Sans', sans-serif" } },
  });
  assert.ok(!findings.some(f => f.ruleId === 'pure-gray'));
});

test('auditExtraction flags too many typefaces', () => {
  const findings = auditExtraction({
    typography: { headingFonts: ['Poppins', 'Georgia', 'Courier'], bodyFont: 'Arial' },
  });
  assert.ok(findings.some(f => f.ruleId === 'too-many-fonts'));
});

test('extractTextFromHtml strips scripts and decodes entities', () => {
  const text = extractTextFromHtml('<p>Hello&mdash;world</p><script>var x=1</script>');
  assert.equal(text, 'Hello—world');
});

test('auditMarkup only crosses text colours against backgrounds for contrast', () => {
  // accent (#d9a441) is a fill, not text — must not be flagged against the bg.
  const css = `<style>:root{--color-background:#faf8f4;--color-foreground:#1f1a13;--color-accent:#d9a441}
    body{background:var(--color-background);color:var(--color-foreground)}
    .badge{background:#d9a441}</style><p>Plain readable copy about the product.</p>`;
  const findings = auditMarkup(css);
  assert.ok(!findings.some(f => f.snippet?.includes('#d9a441 on')), JSON.stringify(findings));
});

test('auditMarkup catches genuine low contrast between real text and bg', () => {
  const html = `<style>body{background:#ffffff;color:#bbbbbb}</style><p>hard to read</p>`;
  assert.ok(auditMarkup(html).some(f => f.ruleId === 'low-contrast' || f.ruleId === 'low-contrast-body'));
});

test('every rule has a stable id and category', () => {
  const ids = new Set<string>();
  for (const r of RULES) {
    assert.ok(!ids.has(r.id), `duplicate rule id ${r.id}`);
    ids.add(r.id);
    assert.ok(['slop', 'copy', 'quality'].includes(r.category));
  }
});
