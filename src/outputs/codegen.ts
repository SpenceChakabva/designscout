import type {
  ComponentType,
  Framework,
  DesignTokenSet,
  DesignPattern,
  CodegenResult,
} from '../shared/types.js';

/**
 * Generate a component from a token set. Deliberately avoids the AI tells that
 * scout_audit flags: no gradient text, no icon-in-tile rows, no 100vh sections,
 * no purple defaults, solid elevation instead of glow.
 */
export function generateComponent(
  componentType: ComponentType,
  framework: Framework,
  tokens: DesignTokenSet,
  patterns: DesignPattern[] = [],
  brief?: string,
): CodegenResult {
  const mood = (patterns.find(p => p.category === 'mood')?.data as any)?.mood || 'minimal';
  const body = SECTION_BUILDERS[componentType](tokens, mood, brief);
  const css = componentCss(tokens);

  const code = framework === 'react'
    ? toReact(componentType, body, css)
    : toHtml(componentType, body, css);

  return {
    componentType,
    framework,
    code,
    filename: framework === 'react'
      ? `${pascal(componentType)}.tsx`
      : `${componentType}.html`,
    dependencies: [],
  };
}

// ── section builders (return inner HTML) ──

type Builder = (t: DesignTokenSet, mood: string, brief?: string) => string;

const SECTION_BUILDERS: Record<ComponentType, Builder> = {
  hero: (_t, _m, brief) => `
  <section class="ds-hero">
    <div class="ds-container">
      <p class="ds-eyebrow">${brief ? esc(brief) : 'Now in public beta'}</p>
      <h1 class="ds-h1">A headline that says what this is, plainly.</h1>
      <p class="ds-lead">One or two sentences of supporting copy. Plain language, the product's own voice, the value stated outright.</p>
      <div class="ds-actions">
        <a class="ds-btn ds-btn-primary" href="#">Get started</a>
        <a class="ds-btn ds-btn-ghost" href="#">Read the docs</a>
      </div>
    </div>
  </section>`,

  navbar: () => `
  <header class="ds-nav">
    <div class="ds-container ds-nav-inner">
      <a class="ds-brand" href="/">Brand</a>
      <nav class="ds-nav-links">
        <a href="#">Product</a>
        <a href="#">Pricing</a>
        <a href="#">Docs</a>
        <a href="#">Blog</a>
      </nav>
      <a class="ds-btn ds-btn-primary ds-btn-sm" href="#">Sign in</a>
    </div>
  </header>`,

  card: () => `
  <article class="ds-card">
    <h3 class="ds-h3">Card title</h3>
    <p>Body copy for the card. Describes one idea. Ends without a trailing arrow.</p>
    <a class="ds-link" href="#">Learn more</a>
  </article>`,

  features: () => `
  <section class="ds-features">
    <div class="ds-container">
      <h2 class="ds-h2">What you get</h2>
      <div class="ds-grid">
        ${[1, 2, 3, 4].map(n => `
        <div class="ds-feature">
          <h3 class="ds-h3">Feature ${n}</h3>
          <p>A concrete sentence about what this does and why it matters.</p>
        </div>`).join('')}
      </div>
    </div>
  </section>`,

  testimonials: () => `
  <section class="ds-testimonials">
    <div class="ds-container">
      <figure class="ds-quote">
        <blockquote>A specific quote about a specific outcome, with a number in it.</blockquote>
        <figcaption>Full Name, Role at Company</figcaption>
      </figure>
    </div>
  </section>`,

  cta: () => `
  <section class="ds-cta">
    <div class="ds-container">
      <h2 class="ds-h2">Ready when you are.</h2>
      <a class="ds-btn ds-btn-primary" href="#">Create an account</a>
    </div>
  </section>`,

  pricing: () => `
  <section class="ds-pricing">
    <div class="ds-container">
      <h2 class="ds-h2">Pricing</h2>
      <div class="ds-grid">
        ${['Free', 'Team', 'Enterprise'].map((tier, i) => `
        <div class="ds-plan${i === 1 ? ' ds-plan-featured' : ''}">
          <h3 class="ds-h3">${tier}</h3>
          <p class="ds-price">${['$0', '$12', 'Custom'][i]}<span>${i < 2 ? '/mo' : ''}</span></p>
          <ul>
            <li>Line item one</li>
            <li>Line item two</li>
            <li>Line item three</li>
          </ul>
          <a class="ds-btn ${i === 1 ? 'ds-btn-primary' : 'ds-btn-ghost'}" href="#">Choose ${tier}</a>
        </div>`).join('')}
      </div>
    </div>
  </section>`,

  footer: () => `
  <footer class="ds-footer">
    <div class="ds-container ds-footer-inner">
      <a class="ds-brand" href="/">Brand</a>
      <nav class="ds-footer-links">
        <a href="#">Product</a>
        <a href="#">Docs</a>
        <a href="#">Privacy</a>
        <a href="#">Contact</a>
      </nav>
      <p class="ds-fineprint">&copy; ${new Date().getFullYear()} Brand, Inc.</p>
    </div>
  </footer>`,
};

// ── css from tokens ──

function componentCss(t: DesignTokenSet): string {
  const c = t.colors;
  const radius = t.borderRadius;
  return `
:root {
${Object.entries(c).map(([k, v]) => `  --color-${k}: ${v};`).join('\n')}
  --font-heading: ${t.typography.fontFamilies.heading};
  --font-body: ${t.typography.fontFamilies.body};
  --radius-md: ${radius.md};
  --radius-lg: ${radius.lg};
  --shadow-md: ${t.shadows.md};
  --maxw: 72rem;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: var(--font-body); color: var(--color-foreground); background: var(--color-background); line-height: 1.6; }
.ds-container { max-width: var(--maxw); margin: 0 auto; padding: 0 1.5rem; }
.ds-h1 { font-family: var(--font-heading); font-size: ${t.typography.fontSizes['4xl'] || '3rem'}; line-height: 1.1; margin: .5rem 0 1rem; letter-spacing: -0.02em; }
.ds-h2 { font-family: var(--font-heading); font-size: ${t.typography.fontSizes['2xl'] || '2rem'}; line-height: 1.2; margin: 0 0 1.5rem; letter-spacing: -0.01em; }
.ds-h3 { font-family: var(--font-heading); font-size: ${t.typography.fontSizes.lg || '1.25rem'}; margin: 0 0 .5rem; }
.ds-eyebrow { text-transform: uppercase; letter-spacing: .08em; font-size: .75rem; color: var(--color-muted-foreground); margin: 0; }
.ds-lead { font-size: ${t.typography.fontSizes.lg || '1.125rem'}; color: var(--color-muted-foreground); max-width: 40ch; }
.ds-hero { padding: 6rem 0; }
.ds-actions { display: flex; gap: .75rem; margin-top: 2rem; flex-wrap: wrap; }
.ds-btn { display: inline-flex; align-items: center; padding: .7rem 1.2rem; border-radius: var(--radius-md); font-weight: 600; text-decoration: none; font-size: .95rem; border: 1px solid transparent; }
.ds-btn-sm { padding: .45rem .9rem; font-size: .85rem; }
.ds-btn-primary { background: var(--color-primary); color: var(--color-primary-foreground); }
.ds-btn-ghost { background: transparent; color: var(--color-foreground); border-color: var(--color-border); }
.ds-link { color: var(--color-primary); text-decoration: none; font-weight: 600; }
.ds-nav { border-bottom: 1px solid var(--color-border); }
.ds-nav-inner { display: flex; align-items: center; justify-content: space-between; padding-top: 1rem; padding-bottom: 1rem; gap: 1.5rem; }
.ds-brand { font-family: var(--font-heading); font-weight: 700; text-decoration: none; color: var(--color-foreground); }
.ds-nav-links { display: flex; gap: 1.25rem; }
.ds-nav-links a, .ds-footer-links a { color: var(--color-muted-foreground); text-decoration: none; font-size: .9rem; }
.ds-grid { display: grid; gap: 1.5rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.ds-card, .ds-feature, .ds-plan { border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 1.5rem; background: var(--color-background); }
.ds-plan-featured { box-shadow: var(--shadow-md); border-color: var(--color-primary); }
.ds-features, .ds-testimonials, .ds-cta, .ds-pricing { padding: 4rem 0; }
.ds-price { font-family: var(--font-heading); font-size: 2rem; margin: .25rem 0 1rem; }
.ds-price span { font-size: 1rem; color: var(--color-muted-foreground); }
.ds-plan ul { list-style: none; padding: 0; margin: 0 0 1.5rem; }
.ds-plan li { padding: .35rem 0; border-bottom: 1px solid var(--color-border); font-size: .9rem; }
.ds-quote blockquote { font-family: var(--font-heading); font-size: 1.5rem; line-height: 1.4; margin: 0 0 1rem; }
.ds-quote figcaption { color: var(--color-muted-foreground); font-size: .9rem; }
.ds-cta { text-align: center; }
.ds-footer { border-top: 1px solid var(--color-border); padding: 3rem 0; }
.ds-footer-inner { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; justify-content: space-between; }
.ds-footer-links { display: flex; gap: 1rem; }
.ds-fineprint { color: var(--color-muted-foreground); font-size: .85rem; margin: 0; width: 100%; }
@media (max-width: 640px) { .ds-nav-links { display: none; } .ds-h1 { font-size: 2rem; } }`;
}

// ── framework wrappers ──

function toHtml(type: ComponentType, body: string, css: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${pascal(type)} · DesignScout</title>
<style>${css}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function toReact(type: ComponentType, body: string, css: string): string {
  const jsx = body
    .replace(/ class=/g, ' className=')
    .replace(/<!--[\s\S]*?-->/g, '');
  return `import './${type}.css'; // ${css.length} bytes of token-derived CSS (below)

export function ${pascal(type)}() {
  return (
    <>
${indent(jsx, 6)}
    </>
  );
}

/* ${type}.css
${css}
*/
`;
}

// ── utils ──

function pascal(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function esc(s: string): string {
  return s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
}
function indent(s: string, n: number): string {
  const pad = ' '.repeat(n);
  return s.split('\n').map(l => (l.trim() ? pad + l : l)).join('\n');
}
