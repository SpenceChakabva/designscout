import type { Page } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { v4 as uuid } from 'uuid';
import type {
  CrawlOptions,
  CrawlResult,
  CrawlPage,
  PageDesignSignals,
  DesignScoutConfig,
} from '../shared/types.js';
import { withBrowser, newContext, gotoWithRetry, dismissOverlays, getPageHeight } from './session.js';

/**
 * Breadth-first crawl of a site's internal pages. Each page gets a full-page
 * screenshot plus lightweight design signals so scout_consistency can diff them.
 * Near-identical pages (same structural fingerprint) are marked as duplicates
 * and not re-captured.
 */
export async function crawlSite(options: CrawlOptions, config: DesignScoutConfig): Promise<CrawlResult> {
  const maxPages = clamp(options.maxPages ?? config.crawlMaxPages, 1, 100);
  const maxDepth = clamp(options.maxDepth ?? config.crawlMaxDepth, 0, 5);
  const sameOriginOnly = options.sameOriginOnly ?? true;
  const viewport = options.viewport ?? { width: config.defaultViewport.width, height: config.defaultViewport.height };

  const start = new URL(options.startUrl);
  const includeRe = options.includePattern ? new RegExp(options.includePattern) : null;
  const excludeRe = options.excludePattern ? new RegExp(options.excludePattern) : null;

  const crawlId = uuid();
  const outDir = path.join(config.screenshotsDir, `crawl-${crawlId}`);
  fs.mkdirSync(outDir, { recursive: true });

  const pages: CrawlPage[] = [];
  const skipped: { url: string; reason: string }[] = [];
  const seenUrls = new Set<string>();
  const fingerprints = new Map<string, string>(); // fingerprint -> first url

  const queue: { url: string; depth: number }[] = [{ url: normalizeUrl(options.startUrl), depth: 0 }];
  seenUrls.add(normalizeUrl(options.startUrl));

  await withBrowser(async (browser) => {
    const context = await newContext(browser, viewport);
    const page = await context.newPage();

    while (queue.length > 0 && pages.length < maxPages) {
      const { url, depth } = queue.shift()!;

      let title = '';
      try {
        title = await gotoWithRetry(page, url, { timeoutMs: config.navTimeoutMs, retries: 1 });
      } catch (err) {
        skipped.push({ url, reason: (err as Error).message.slice(0, 120) });
        continue;
      }

      await dismissOverlays(page).catch(() => {});
      await page.waitForTimeout(300);
      await autoScroll(page);

      const fingerprint = await computeFingerprint(page);
      const duplicateOf = fingerprints.get(fingerprint);
      const relPath = safePath(url, start);

      const record: CrawlPage = { siteId: '', url, path: relPath, depth, title, fingerprint };

      if (duplicateOf) {
        record.duplicateOf = duplicateOf;
      } else {
        fingerprints.set(fingerprint, url);
        const shotPath = path.join(outDir, `${slug(relPath)}.png`);
        try {
          await page.screenshot({ path: shotPath, fullPage: true, type: 'png' });
          record.screenshot = shotPath;
        } catch { /* tall page */ }
        record.signals = await collectSignals(page);
      }

      pages.push(record);

      // Enqueue links
      if (depth < maxDepth) {
        const links = await extractLinks(page);
        for (const href of links) {
          let target: URL;
          try { target = new URL(href, url); } catch { continue; }
          if (target.protocol !== 'http:' && target.protocol !== 'https:') continue;
          if (sameOriginOnly && target.origin !== start.origin) continue;
          const norm = normalizeUrl(target.href);
          if (seenUrls.has(norm)) continue;
          if (includeRe && !includeRe.test(target.pathname)) continue;
          if (excludeRe && excludeRe.test(target.pathname)) continue;
          if (/\.(pdf|zip|png|jpe?g|gif|svg|mp4|webm|dmg|exe|woff2?)$/i.test(target.pathname)) continue;
          seenUrls.add(norm);
          queue.push({ url: norm, depth: depth + 1 });
        }
      }
    }

    await context.close();
  });

  return {
    id: crawlId,
    startUrl: options.startUrl,
    pages,
    skipped,
    generatedAt: new Date().toISOString(),
  };
}

// ── helpers ──

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    // Drop tracking params, keep meaningful query
    const drop = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'fbclid', 'gclid'];
    for (const key of drop) u.searchParams.delete(key);
    let s = u.toString();
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s;
  } catch {
    return raw;
  }
}

function safePath(url: string, start: URL): string {
  try {
    const u = new URL(url);
    return (u.pathname + u.search) || '/';
  } catch {
    return url;
  }
}

function slug(p: string): string {
  const s = p.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  return s || 'index';
}

async function autoScroll(page: Page): Promise<void> {
  try {
    const height = await getPageHeight(page);
    const step = 800;
    for (let y = 0; y < height; y += step) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(120);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
  } catch { /* noop */ }
}

async function extractLinks(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href]'))
      .map(a => a.getAttribute('href') || '')
      .filter(Boolean)
      .slice(0, 300),
  ).catch(() => []);
}

/** Structural fingerprint: normalized tag skeleton + landmark text. Ignores content. */
async function computeFingerprint(page: Page): Promise<string> {
  const skeleton = await page.evaluate(() => {
    const parts: string[] = [];
    const walk = (el: Element, depth: number) => {
      if (depth > 4) return;
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'svg', 'path', 'noscript'].includes(tag)) return;
      const cls = (typeof el.className === 'string' ? el.className : '')
        .trim().split(/\s+/).filter(c => c && !/\d/.test(c)).slice(0, 2).join('.');
      parts.push(`${'  '.repeat(depth)}${tag}${cls ? '.' + cls : ''}`);
      for (const child of Array.from(el.children).slice(0, 12)) walk(child, depth + 1);
    };
    if (document.body) walk(document.body, 0);
    const nav = document.querySelector('nav, header')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) || '';
    return parts.join('\n') + '\n::NAV::' + nav;
  }).catch(() => Math.random().toString());
  return crypto.createHash('sha1').update(skeleton).digest('hex').slice(0, 16);
}

async function collectSignals(page: Page): Promise<PageDesignSignals> {
  return page.evaluate(() => {
    const colorSet = new Set<string>();
    const bgSet = new Set<string>();
    const fontSet = new Set<string>();
    const sizeSet = new Set<string>();
    const radiusSet = new Set<string>();
    const maxWidthSet = new Set<string>();

    const els = document.querySelectorAll('body *');
    const step = Math.max(1, Math.floor(els.length / 400));
    for (let i = 0; i < els.length; i += step) {
      const s = getComputedStyle(els[i]);
      if (s.color) colorSet.add(s.color);
      const bg = s.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') bgSet.add(bg);
      if (s.fontFamily) fontSet.add(s.fontFamily.split(',')[0].replace(/["']/g, '').trim());
      sizeSet.add(s.fontSize);
      if (s.borderRadius && s.borderRadius !== '0px') radiusSet.add(s.borderRadius);
      if (s.maxWidth && s.maxWidth !== 'none' && s.maxWidth !== '100%') maxWidthSet.add(s.maxWidth);
    }

    const h1 = document.querySelector('h1');
    const bodyEl = document.querySelector('p') || document.body;
    const sig = (el: Element | null) =>
      el ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100) : '';

    return {
      colors: [...colorSet].slice(0, 24),
      backgrounds: [...bgSet].slice(0, 16),
      fontFamilies: [...fontSet].slice(0, 12),
      fontSizes: [...sizeSet].sort(),
      borderRadii: [...radiusSet].slice(0, 12),
      maxWidths: [...maxWidthSet].slice(0, 8),
      headingFont: h1 ? getComputedStyle(h1).fontFamily : '',
      bodyFont: getComputedStyle(bodyEl).fontFamily,
      h1Count: document.querySelectorAll('h1').length,
      navSignature: sig(document.querySelector('nav, header')),
      footerSignature: sig(document.querySelector('footer')),
    };
  });
}
