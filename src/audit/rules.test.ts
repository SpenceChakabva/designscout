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

test('flags a filler badge above the h1', () => {
  const html = '<section><span class="badge"><span class="dot"></span> MCP server</span><h1>Title</h1></section>';
  assert.ok(runAudit({ html }).some(f => f.ruleId === 'filler-badge'));
});

test('flags redundant eyebrow labels above headings', () => {
  const block = '<span class="eyebrow">Section</span><h2>Heading</h2>';
  assert.ok(runAudit({ html: block.repeat(2) }).some(f => f.ruleId === 'redundant-eyebrow'));
});

test('does not flag a single eyebrow (needs a pattern, not one-off)', () => {
  const html = '<span class="eyebrow">Section</span><h2>Heading</h2>';
  assert.ok(!runAudit({ html }).some(f => f.ruleId === 'redundant-eyebrow'));
});

test('flags decorative italics on an ordinary word, not blockquotes', () => {
  const html = '<p>Check contrast in light <em>and</em> dark.</p>';
  assert.ok(runAudit({ html }).some(f => f.ruleId === 'random-italic'));
  const quoted = '<blockquote>It changed <em>everything</em> for us.</blockquote>';
  assert.ok(!runAudit({ html: quoted }).some(f => f.ruleId === 'random-italic'));
});

test('flags monospace used on non-code labels', () => {
  const css = '.tag{font-family:"JetBrains Mono",monospace} .pill{font-family:"JetBrains Mono",monospace} .code{font-family:"JetBrains Mono",monospace}';
  const findings = runAudit({ css });
  assert.ok(findings.some(f => f.ruleId === 'monospace-costume'));
});

test('does not flag monospace on actual code/terminal selectors', () => {
  const css = '.code{font-family:"JetBrains Mono",monospace} .terminal__body{font-family:"JetBrains Mono",monospace} pre{font-family:"JetBrains Mono",monospace}';
  assert.ok(!runAudit({ css }).some(f => f.ruleId === 'monospace-costume'));
});

test('flags hardcoded hex colors with no design tokens', () => {
  const css = '.a{color:#111111}.b{color:#222222}.c{color:#333333}.d{color:#444444}.e{color:#555555}.f{color:#666666}';
  assert.ok(runAudit({ css }).some(f => f.ruleId === 'no-design-tokens'));
});

test('does not flag hex colors already routed through custom properties', () => {
  const css = ':root{--a:#111111;--b:#222222;--c:#333333;--d:#444444;--e:#555555;--f:#666666}.x{color:var(--a);background:var(--b)}';
  assert.ok(!runAudit({ css }).some(f => f.ruleId === 'no-design-tokens'));
});

test('flags a hero with no product visual on an assembled page', () => {
  const html = '<body><header></header><section class="hero"><h1>Title</h1><p>Lead copy.</p><a class="btn">Go</a></section><footer></footer></body>';
  assert.ok(runAudit({ html }).some(f => f.ruleId === 'hero-no-product-visual'));
});

test('does not flag a hero that shows a screenshot or terminal demo', () => {
  const html = '<body><header></header><section class="hero"><h1>Title</h1><img src="shot.png"></section><footer></footer></body>';
  assert.ok(!runAudit({ html }).some(f => f.ruleId === 'hero-no-product-visual'));
});

test('does not flag a single scaffolded component dropped in its own HTML file', () => {
  const html = '<!DOCTYPE html><html><body><section class="ds-hero"><h1>Title</h1><p>Lead.</p></section></body></html>';
  assert.ok(!runAudit({ html }).some(f => f.ruleId === 'hero-no-product-visual'));
});

test('flags a generic listicle headline', () => {
  const html = '<h2>Eight things it does well</h2>';
  assert.ok(runAudit({ html }).some(f => f.ruleId === 'generic-headline'));
});

test('flags multiple CTAs with no emphasized primary', () => {
  const html = '<a class="btn">Install</a><a class="btn">Docs</a>';
  assert.ok(runAudit({ html }).some(f => f.ruleId === 'unemphasized-cta'));
});

test('does not flag CTAs when one carries a primary variant', () => {
  const html = '<a class="btn btn--primary">Install</a><a class="btn btn--ghost">Docs</a>';
  assert.ok(!runAudit({ html }).some(f => f.ruleId === 'unemphasized-cta'));
});

test('flags an all-neutral palette with no accent color', () => {
  const findings = runAudit({ colors: ['#111111', '#888888', '#eeeeee'] });
  assert.ok(findings.some(f => f.ruleId === 'no-accent-color'));
});

test('does not flag a palette that has a real accent', () => {
  const findings = runAudit({ colors: ['#111111', '#888888', '#0d7c5f'] });
  assert.ok(!findings.some(f => f.ruleId === 'no-accent-color'));
});

test('flags mixed solid and outline icon styles', () => {
  const html = `
    <svg fill="currentColor"><path d="M1 1"/></svg>
    <svg fill="currentColor"><path d="M2 2"/></svg>
    <svg fill="none" stroke="currentColor"><path d="M3 3"/></svg>
    <svg fill="none" stroke="currentColor"><path d="M4 4"/></svg>`;
  assert.ok(runAudit({ html }).some(f => f.ruleId === 'inconsistent-icon-style'));
});

test('flags a large heading with no text-wrap', () => {
  const css = 'h1{font-size:clamp(2.5rem,6vw,3.75rem)}';
  assert.ok(runAudit({ css }).some(f => f.ruleId === 'headline-no-text-wrap'));
});

test('does not flag a large heading that already balances', () => {
  const css = 'h1{font-size:3rem;text-wrap:balance}';
  assert.ok(!runAudit({ css }).some(f => f.ruleId === 'headline-no-text-wrap'));
});

test('flags a stat counter missing tabular-nums', () => {
  const html = '<span class="stat">23</span>';
  assert.ok(runAudit({ html }).some(f => f.ruleId === 'counter-no-tabular-nums'));
});

test('flags an async fetch with no loading state anywhere', () => {
  const html = '<script>fetch("/api/data").then(r => r.json())</script>';
  assert.ok(runAudit({ html }).some(f => f.ruleId === 'missing-loading-state'));
});

test('does not flag a fetch that has a loading indicator', () => {
  const html = '<script>fetch("/api/data")</script><div class="spinner"></div>';
  assert.ok(!runAudit({ html }).some(f => f.ruleId === 'missing-loading-state'));
});

test('flags buttons with no hover/active/transition styling at all', () => {
  const html = '<button>Go</button>';
  const css = '.unrelated{color:red}';
  assert.ok(runAudit({ html, css }).some(f => f.ruleId === 'no-interactive-feedback'));
});

test('does not flag buttons that have a transition', () => {
  const html = '<button class="btn">Go</button>';
  const css = '.btn{transition:opacity .2s ease}';
  assert.ok(!runAudit({ html, css }).some(f => f.ruleId === 'no-interactive-feedback'));
});

test('every rule has a stable id and category', () => {
  const ids = new Set<string>();
  for (const r of RULES) {
    assert.ok(!ids.has(r.id), `duplicate rule id ${r.id}`);
    ids.add(r.id);
    assert.ok(['slop', 'copy', 'quality'].includes(r.category));
  }
});
