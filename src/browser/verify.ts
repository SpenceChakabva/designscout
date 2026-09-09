/**
 * scout_verify — render generated output and check it.
 *
 * Loads a target (local HTML file, raw HTML string, or URL) in headless
 * Chromium at one or more viewports and reports the things that make
 * AI-generated pages fail on real devices: mobile horizontal overflow,
 * tiny tap targets, sub-12px text, a missing viewport meta / lang / charset,
 * broken images, console errors, failed subresources, inline-script syntax
 * errors, and the design-tell lint from the audit rules.
 *
 * New tool — reuses withBrowser / newContext from session.ts (note the
 * `__name` shim there: every in-page function is self-contained so it
 * serializes cleanly under both tsc and tsx).
 */

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Browser, Page } from 'playwright';
import type { DesignScoutConfig, NamedViewport } from '../shared/types.js';
import { withBrowser, newContext, gotoWithRetry } from './session.js';
import { auditMarkup, type Finding } from '../audit/rules.js';

// ── Types (exported — server.ts wires the tool, no shared/types.ts edit) ──

export interface VerifyInput {
  filePath?: string;
  html?: string;
  url?: string;
  viewports?: NamedViewport[];
}

export interface OverflowElement {
  selector: string;
  right: number;
  width: number;
}

export interface TapTargetIssue {
  selector: string;
  width: number;
  height: number;
  label: string;
}

export interface SmallTextIssue {
  selector: string;
  fontSize: number;
  sample: string;
}

export interface ViewportResult {
  viewport: string;
  width: number;
  height: number;
  horizontalScroll: boolean;
  scrollWidth: number;
  clientWidth: number;
  overflowElements: OverflowElement[];
  tapTargets: TapTargetIssue[];
  smallText: SmallTextIssue[];
  error?: string;
}

export interface FailedResource {
  url: string;
  status: number;
}

export interface VerifyGlobal {
  hasViewportMeta: boolean;
  hasLang: boolean;
  hasCharset: boolean;
  failedImages: string[];
  consoleErrors: string[];
  pageErrors: string[];
  failedSubresources: FailedResource[];
}

export interface ScriptSyntaxError {
  scriptIndex: number;
  message: string;
  snippet: string;
}

export interface VerifySummary {
  viewports: number;
  horizontalScrollViewports: string[];
  overflowElements: number;
  tapTargetIssues: number;
  smallTextNodes: number;
  missingViewportMeta: boolean;
  missingLang: boolean;
  missingCharset: boolean;
  failedImages: number;
  consoleErrors: number;
  pageErrors: number;
  failedSubresources: number;
  syntaxErrors: number;
  tellFindings: number;
}

export interface VerifyReport {
  ok: boolean;
  target: string;
  viewportResults: ViewportResult[];
  global: VerifyGlobal;
  tellFindings: Finding[];
  syntaxErrors: ScriptSyntaxError[];
  summary: VerifySummary;
}

// ── Raw shapes returned from page.evaluate ──

interface RawViewportIssues {
  horizontalScroll: boolean;
  scrollWidth: number;
  clientWidth: number;
  overflowElements: OverflowElement[];
  tapTargets: TapTargetIssue[];
  smallText: SmallTextIssue[];
}

interface RawGlobalIssues {
  hasViewportMeta: boolean;
  hasLang: boolean;
  hasCharset: boolean;
  failedImages: string[];
}

// ════════════════════════════════════════════════════════════════════════════
// Public entry
// ════════════════════════════════════════════════════════════════════════════

export async function verifyOutput(
  input: VerifyInput,
  config: DesignScoutConfig,
): Promise<VerifyReport> {
  const viewports: NamedViewport[] = input.viewports?.length
    ? input.viewports
    : [config.viewportPresets.mobile, config.viewportPresets.tablet, config.viewportPresets.desktop];

  let markup: string | undefined = input.html;
  if (input.filePath) {
    markup = fs.readFileSync(input.filePath, 'utf-8');
  }
  if (!input.filePath && !input.html && !input.url) {
    throw new Error('verifyOutput: provide one of filePath, html, or url.');
  }

  const target = input.url
    ? input.url
    : input.filePath
      ? `file:${input.filePath}`
      : 'inline-html';

  const loadTarget = async (page: Page): Promise<void> => {
    if (input.url) {
      await gotoWithRetry(page, input.url, { timeoutMs: config.navTimeoutMs, retries: config.captureRetries });
    } else if (input.filePath) {
      await page.goto(pathToFileURL(input.filePath).href, { waitUntil: 'load', timeout: config.navTimeoutMs });
    } else {
      await page.setContent(markup as string, { waitUntil: 'load', timeout: config.navTimeoutMs });
    }
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  };

  const syntaxErrors = markup ? checkInlineScripts(markup) : [];
  const tellFindings = markup ? auditMarkup(markup) : [];

  const { viewportResults, global } = await withBrowser(async (browser: Browser) => {
    const results: ViewportResult[] = [];
    let glob: VerifyGlobal = {
      hasViewportMeta: false,
      hasLang: false,
      hasCharset: false,
      failedImages: [],
      consoleErrors: [],
      pageErrors: [],
      failedSubresources: [],
    };

    for (let i = 0; i < viewports.length; i++) {
      const vp = viewports[i];
      const context = await newContext(browser, { width: vp.width, height: vp.height });
      const page = await context.newPage();

      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const failedSubresources: FailedResource[] = [];

      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
      });
      page.on('pageerror', (err) => {
        pageErrors.push((err?.message || String(err)).slice(0, 300));
      });
      page.on('response', (resp) => {
        try {
          if (resp.request().resourceType() === 'document') return;
          if (resp.status() >= 400) failedSubresources.push({ url: resp.url().slice(0, 200), status: resp.status() });
        } catch { /* noop */ }
      });
      page.on('requestfailed', (req) => {
        try {
          if (req.resourceType() === 'document') return;
          failedSubresources.push({ url: req.url().slice(0, 200), status: 0 });
        } catch { /* noop */ }
      });

      try {
        await loadTarget(page);

        let raw: RawViewportIssues;
        try {
          raw = await page.evaluate(detectViewportIssues);
        } catch (err) {
          results.push({
            viewport: vp.label,
            width: vp.width,
            height: vp.height,
            horizontalScroll: false,
            scrollWidth: 0,
            clientWidth: 0,
            overflowElements: [],
            tapTargets: [],
            smallText: [],
            error: (err as Error).message,
          });
          continue;
        }

        results.push({
          viewport: vp.label,
          width: vp.width,
          height: vp.height,
          horizontalScroll: raw.horizontalScroll,
          scrollWidth: raw.scrollWidth,
          clientWidth: raw.clientWidth,
          overflowElements: raw.overflowElements,
          tapTargets: raw.tapTargets,
          smallText: raw.smallText,
        });

        if (i === 0) {
          const rawGlobal = await page.evaluate(detectGlobalIssues).catch(() => ({
            hasViewportMeta: false,
            hasLang: false,
            hasCharset: false,
            failedImages: [] as string[],
          }));
          glob = {
            ...rawGlobal,
            consoleErrors: dedupe(consoleErrors),
            pageErrors: dedupe(pageErrors),
            failedSubresources: dedupeResources(failedSubresources),
          };
        }
      } finally {
        await context.close();
      }
    }

    return { viewportResults: results, global: glob };
  });

  const horizontalScrollViewports = viewportResults.filter(v => v.horizontalScroll).map(v => v.viewport);

  const summary: VerifySummary = {
    viewports: viewportResults.length,
    horizontalScrollViewports,
    overflowElements: viewportResults.reduce((n, v) => n + v.overflowElements.length, 0),
    tapTargetIssues: viewportResults.reduce((n, v) => n + v.tapTargets.length, 0),
    smallTextNodes: viewportResults.reduce((n, v) => n + v.smallText.length, 0),
    missingViewportMeta: !global.hasViewportMeta,
    missingLang: !global.hasLang,
    missingCharset: !global.hasCharset,
    failedImages: global.failedImages.length,
    consoleErrors: global.consoleErrors.length,
    pageErrors: global.pageErrors.length,
    failedSubresources: global.failedSubresources.length,
    syntaxErrors: syntaxErrors.length,
    tellFindings: tellFindings.length,
  };

  const ok =
    horizontalScrollViewports.length === 0 &&
    global.hasViewportMeta &&
    global.failedImages.length === 0 &&
    global.consoleErrors.length === 0 &&
    global.pageErrors.length === 0 &&
    global.failedSubresources.length === 0 &&
    syntaxErrors.length === 0;

  return { ok, target, viewportResults, global, tellFindings, syntaxErrors, summary };
}

// ════════════════════════════════════════════════════════════════════════════
// Node-side helpers
// ════════════════════════════════════════════════════════════════════════════

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

function dedupeResources(arr: FailedResource[]): FailedResource[] {
  const seen = new Set<string>();
  const out: FailedResource[] = [];
  for (const r of arr) {
    const key = `${r.url}:${r.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Cheap best-effort JS syntax check on inline <script> bodies.
 * Skips external scripts, JSON-LD, and ES modules (import/export lines
 * legitimately fail `new Function`).
 */
export function checkInlineScripts(markup: string): ScriptSyntaxError[] {
  const errors: ScriptSyntaxError[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  let index = 0;
  while ((m = re.exec(markup)) !== null) {
    index++;
    const attrs = m[1] || '';
    const body = m[2] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/type\s*=\s*["']?(?:application\/ld\+json|module|text\/template|text\/x-template|text\/html)["']?/i.test(attrs)) continue;
    if (!body.trim()) continue;
    try {
      // eslint-disable-next-line no-new-func
      new Function(body);
    } catch (err) {
      errors.push({
        scriptIndex: index,
        message: (err as Error).message,
        snippet: body.trim().replace(/\s+/g, ' ').slice(0, 140),
      });
    }
  }
  return errors;
}

// ════════════════════════════════════════════════════════════════════════════
// In-page extractors  (self-contained — serialized via page.evaluate)
// ════════════════════════════════════════════════════════════════════════════

function detectViewportIssues(): RawViewportIssues {
  const MAX_LIST = 15;
  const MAX_ELEMENTS = 4000;
  const innerWidth = window.innerWidth;
  const doc = document.documentElement;

  const selectorPath = (node: Element): string => {
    const parts: string[] = [];
    let cur: Element | null = node;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < 4) {
      let part = cur.tagName.toLowerCase();
      const id = (cur as HTMLElement).id;
      if (id) {
        parts.unshift(part + '#' + id);
        break;
      }
      const cls = (typeof cur.className === 'string' && cur.className.trim())
        ? '.' + cur.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
      parts.unshift(part + cls);
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(' > ');
  };

  const inClippedAncestor = (node: Element): boolean => {
    let p: Element | null = node.parentElement;
    while (p && p !== document.body && p !== doc) {
      const s = getComputedStyle(p);
      const vals = [s.overflow, s.overflowX, s.overflowY];
      if (vals.some(v => v === 'hidden' || v === 'auto' || v === 'scroll' || v === 'clip')) return true;
      p = p.parentElement;
    }
    return false;
  };

  const isVisible = (el: Element, rect: DOMRect): boolean => {
    if (rect.width <= 0 || rect.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };

  const all = Array.from(document.querySelectorAll('body *'));
  const limit = Math.min(all.length, MAX_ELEMENTS);

  // ── Horizontal overflow ──
  const scrollWidth = doc.scrollWidth;
  const clientWidth = doc.clientWidth;
  const horizontalScroll = scrollWidth > clientWidth + 1;

  const overflowElements: OverflowElement[] = [];
  for (let i = 0; i < limit && overflowElements.length < MAX_LIST; i++) {
    const el = all[i];
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.right > innerWidth + 1 && rect.left >= -1) {
      if (inClippedAncestor(el)) continue;
      const s = getComputedStyle(el);
      if (s.position === 'fixed') continue;
      overflowElements.push({
        selector: selectorPath(el),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      });
    }
  }

  // ── Tap targets ──
  const tapTargets: TapTargetIssue[] = [];
  const interactive = Array.from(document.querySelectorAll('a, button, input, [role="button"]'));
  for (const el of interactive) {
    if (tapTargets.length >= 20) break;
    const rect = el.getBoundingClientRect();
    if (!isVisible(el, rect)) continue;
    if (rect.width < 44 || rect.height < 44) {
      const label = (el.textContent || '').trim().slice(0, 40)
        || el.getAttribute('aria-label')
        || (el as HTMLInputElement).value
        || (el as HTMLElement).getAttribute('type')
        || '';
      tapTargets.push({
        selector: selectorPath(el),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        label: label || '(no label)',
      });
    }
  }

  // ── Text smaller than 12px ──
  const smallText: SmallTextIssue[] = [];
  for (let i = 0; i < limit && smallText.length < 15; i++) {
    const el = all[i];
    const direct = Array.from(el.childNodes).find(
      n => n.nodeType === 3 && (n.textContent || '').trim().length > 10,
    );
    if (!direct) continue;
    const rect = el.getBoundingClientRect();
    if (!isVisible(el, rect)) continue;
    const fontSize = parseFloat(getComputedStyle(el).fontSize);
    if (fontSize > 0 && fontSize < 12) {
      smallText.push({
        selector: selectorPath(el),
        fontSize: Math.round(fontSize * 10) / 10,
        sample: (direct.textContent || '').trim().slice(0, 60),
      });
    }
  }

  return { horizontalScroll, scrollWidth, clientWidth, overflowElements, tapTargets, smallText };
}

function detectGlobalIssues(): RawGlobalIssues {
  const hasViewportMeta = !!document.querySelector('meta[name="viewport" i]');
  const hasLang = !!document.documentElement.getAttribute('lang');
  const hasCharset = !!document.querySelector('meta[charset], meta[http-equiv="Content-Type" i]');

  const failedImages: string[] = [];
  for (const img of Array.from(document.images)) {
    if (img.complete && img.naturalWidth === 0) {
      failedImages.push((img.getAttribute('src') || img.currentSrc || 'img').slice(0, 200));
    }
  }

  return { hasViewportMeta, hasLang, hasCharset, failedImages };
}
