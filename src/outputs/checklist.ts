import fs from 'node:fs';
import type { DesignPattern } from '../shared/types.js';

/**
 * Pre-generation checklist.
 *
 * FEEDBACK §3: the first build shipped desktop-only, static, with placeholder art
 * because imagery / animation / forms / theme transition / responsive were never
 * surfaced as choices — the user had to ask for each in a separate follow-up.
 * This turns those into explicit decisions, seeded from what the *reference*
 * site actually does, before scout_codegen / scout_styles run.
 */

export interface ChecklistItem {
  key: 'imagery' | 'motion' | 'forms' | 'theming' | 'responsive' | 'fonts' | 'bundling';
  question: string;
  referenceSignal: string;      // what the captured reference tells us
  recommendation: string;       // the default to take if the user says nothing
  handledBy: string;            // which tool(s) act on the decision
}

export interface PreGenChecklist {
  siteUrl: string;
  items: ChecklistItem[];
  summary: string;
}

interface ExtractionLike {
  animations?: { libraries?: string[]; scrollTriggered?: boolean; totalAnimatedCount?: number };
  layout?: { breakpoints?: string[] };
  typography?: { googleFonts?: string[]; loadedFonts?: string[] };
  icons?: { iconImageCount?: number };
  cssVariables?: Record<string, string>;
}

interface HtmlSignals {
  imgCount: number;
  hasForm: boolean;
  hasDialog: boolean;
  hasPrefersColorScheme: boolean;
  hasViewportMeta: boolean;
}

function scanHtml(htmlPath: string | undefined): HtmlSignals {
  const empty: HtmlSignals = {
    imgCount: 0, hasForm: false, hasDialog: false,
    hasPrefersColorScheme: false, hasViewportMeta: false,
  };
  if (!htmlPath || !fs.existsSync(htmlPath)) return empty;
  let html = '';
  try { html = fs.readFileSync(htmlPath, 'utf-8'); } catch { return empty; }
  return {
    imgCount: (html.match(/<img[\s>]/gi) || []).length,
    hasForm: /<form[\s>]/i.test(html),
    hasDialog: /<dialog[\s>]|role=["']dialog["']|aria-modal=["']true["']/i.test(html),
    hasPrefersColorScheme: /prefers-color-scheme/i.test(html),
    hasViewportMeta: /<meta[^>]+name=["']viewport["']/i.test(html),
  };
}

export function buildPreGenChecklist(
  siteUrl: string,
  extraction: ExtractionLike | null | undefined,
  patterns: DesignPattern[],
  htmlPath?: string,
): PreGenChecklist {
  const ex = extraction || {};
  const html = scanHtml(htmlPath);
  const items: ChecklistItem[] = [];

  // ── Imagery ──
  const usesPhotography = html.imgCount > 3 || (ex.icons?.iconImageCount ?? 0) < html.imgCount;
  items.push({
    key: 'imagery',
    question: 'Real imagery, procedural placeholder art, or none?',
    referenceSignal: html.imgCount
      ? `reference uses ~${html.imgCount} <img> element(s)`
      : 'reference has no raster imagery',
    recommendation: usesPhotography
      ? 'Source real photos (curated + license-checked) or generate procedural stand-ins with honest TEMP labels — do not ship empty.'
      : 'Text-and-shape only; no image budget needed.',
    handledBy: 'scout_bundle (inline assets), manual sourcing',
  });

  // ── Motion ──
  const libs = ex.animations?.libraries || [];
  const scrollDriven = !!ex.animations?.scrollTriggered;
  items.push({
    key: 'motion',
    question: 'Static, scroll-motion, or full interactive layer?',
    referenceSignal: libs.length
      ? `reference loads ${libs.join(', ')}${scrollDriven ? ' + scroll-triggered effects' : ''}`
      : (scrollDriven ? 'reference has scroll-triggered CSS' : 'reference is static'),
    recommendation: libs.length || scrollDriven
      ? "Generate a guarded motion layer with scout_motion (reduced-motion bail, .anim-ready gate)."
      : 'Static is faithful to the reference; skip the motion layer.',
    handledBy: 'scout_motion',
  });

  // ── Forms / interaction ──
  items.push({
    key: 'forms',
    question: 'Contact form / modal dialog needed?',
    referenceSignal: `${html.hasForm ? 'has <form>' : 'no <form>'}${html.hasDialog ? ', has a dialog/modal' : ''}`,
    recommendation: html.hasForm || html.hasDialog
      ? 'Include an accessible <form> + native <dialog> (focus trap, ESC, backdrop) with client-side validation.'
      : 'No form; a single CTA link is enough.',
    handledBy: 'scout_codegen (cta), manual dialog',
  });

  // ── Theming ──
  const cssVars = Object.keys(ex.cssVariables || {});
  const tokenised = cssVars.length > 4;
  items.push({
    key: 'theming',
    question: 'Light only, or light + dark with a toggle / transition?',
    referenceSignal: html.hasPrefersColorScheme
      ? 'reference responds to prefers-color-scheme'
      : (tokenised ? 'reference is token-driven (dark is cheap to add)' : 'reference is single-theme'),
    recommendation: html.hasPrefersColorScheme
      ? 'Ship both themes: full palette on :root, guarded dark media query, [data-theme] override. Verify with scout_contrast in both.'
      : 'Light only is fine; still run scout_contrast.',
    handledBy: 'scout_tokens, scout_contrast, scout_motion (theme_transition)',
  });

  // ── Responsive ──
  const bps = ex.layout?.breakpoints || [];
  items.push({
    key: 'responsive',
    question: 'Which widths must be verified?',
    referenceSignal: bps.length ? `reference breakpoints: ${bps.join(', ')}` : 'no media-query breakpoints detected',
    recommendation: 'Build mobile-first; verify at 360 / 390 / 768 / 1024 / 1440 with scout_verify. Every multi-column grid gets minmax(0, 1fr); <meta viewport> is mandatory.',
    handledBy: 'scout_verify, scout_capture --responsive',
  });

  // ── Fonts ──
  const gfonts = ex.typography?.googleFonts || ex.typography?.loadedFonts || [];
  items.push({
    key: 'fonts',
    question: 'Self-host fonts or load from Google Fonts?',
    referenceSignal: gfonts.length ? `reference loads: ${gfonts.slice(0, 4).join(', ')}` : 'system fonts only',
    recommendation: 'Pick characterful display + quiet body with real fallback stacks; scout_audit flags the monoculture faces.',
    handledBy: 'scout_tokens, scout_audit',
  });

  // ── Bundling ──
  items.push({
    key: 'bundling',
    question: 'Does the output need to be self-contained (offline / strict CSP)?',
    referenceSignal: 'n/a — depends on the deploy target',
    recommendation: 'If it ships as a single file or a claude.ai Artifact: run scout_bundle to inline images + resolve CDN deps with scout_deps.',
    handledBy: 'scout_bundle, scout_deps',
  });

  const openDecisions = items.filter(i =>
    /Generate a guarded|Ship both themes|Include an accessible|Source real photos/.test(i.recommendation),
  ).length;

  return {
    siteUrl,
    items,
    summary:
      `${items.length} decisions to confirm before generating. ` +
      `Based on ${siteUrl}, ${openDecisions} likely need active work (${items.filter(i =>
        /Generate a guarded|Ship both themes|Include an accessible|Source real photos/.test(i.recommendation))
        .map(i => i.key).join(', ') || 'none'}). ` +
      `Confirm each with the user, then run scout_styles / scout_codegen.`,
  };
}
