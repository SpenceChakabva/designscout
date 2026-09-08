import type { Browser, Page } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { v4 as uuid } from 'uuid';
import type {
  CaptureOptions,
  CapturedSite,
  CapturedScreenshot,
  DesignScoutConfig,
  NamedViewport,
  LayoutIssue,
} from '../shared/types.js';
import { deviceForWidth } from '../shared/config.js';
import {
  withBrowser,
  newContext,
  gotoWithRetry,
  dismissOverlays,
  getPageHeight,
} from './session.js';
import {
  extractFromPage,
  detectLayoutIssues,
  type RawLayoutIssue,
} from './extract.js';

/**
 * Capture a site. Scrolls the full page to trigger lazy content, then captures
 * overlapping viewport frames. Supports one or more named viewports (responsive
 * mode) and selector-scoped capture. No LLM — Claude Code reads the PNGs itself.
 */
export async function captureSite(
  options: CaptureOptions,
  config: DesignScoutConfig,
): Promise<CapturedSite> {
  const scrollDelay = options.scrollDelay ?? config.defaultScrollDelay;
  const maxScrolls = options.maxScrolls ?? config.maxScrolls;
  const retries = options.retries ?? config.captureRetries;
  const dismissBanners = options.dismissBanners ?? true;

  const viewports: NamedViewport[] = resolveViewports(options, config);

  const siteId = uuid();
  const siteDir = path.join(config.screenshotsDir, siteId);
  fs.mkdirSync(siteDir, { recursive: true });

  return withBrowser(async (browser: Browser) => {
    const screenshots: CapturedScreenshot[] = [];
    const layoutIssues: LayoutIssue[] = [];
    const viewportMeta: Record<string, unknown>[] = [];

    let title = '';
    let primaryExtraction: unknown = null;
    let sections: unknown[] = [];
    let primaryCapture: Record<string, unknown> | null = null;
    let basicMeta: { meta: Record<string, string>; bodyClasses: string } = { meta: {}, bodyClasses: '' };
    let bannersDismissed = 0;
    let htmlPath: string | null = null;

    for (let v = 0; v < viewports.length; v++) {
      const vp = viewports[v];
      const isPrimary = v === 0;
      const context = await newContext(browser, { width: vp.width, height: vp.height });
      const page = await context.newPage();

      try {
        const pageTitle = await gotoWithRetry(page, options.url, { timeoutMs: config.navTimeoutMs, retries });
        if (isPrimary) title = pageTitle;

        if (dismissBanners) {
          bannersDismissed += await dismissOverlays(page);
          // A dismissal click can navigate; let it settle.
          await page.waitForLoadState('domcontentloaded').catch(() => {});
          await page.waitForTimeout(400);
        }

        if (options.selector) {
          const shots = await captureSelector(page, options.selector, siteDir, siteId, vp);
          screenshots.push(...shots);
        } else {
          await triggerLazyContent(page, vp, scrollDelay, maxScrolls);

          // Grab DOM data now — the page is fully loaded and scrolled, and the
          // frame-by-frame screenshotting below is where evaluate calls tend to
          // race with client-side navigation.
          if (isPrimary) {
            await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
            await page.waitForTimeout(250);

            sections = await detectSections(page).catch(() => []);

            basicMeta = await page.evaluate(() => {
              const meta: Record<string, string> = {};
              document.querySelectorAll('meta').forEach((el) => {
                const name = el.getAttribute('name') || el.getAttribute('property') || '';
                const content = el.getAttribute('content') || '';
                if (name && content) meta[name] = content;
              });
              return { meta, bodyClasses: document.body?.className || '' };
            }).catch(() => ({ meta: {}, bodyClasses: '' }));

            primaryExtraction = await page.evaluate(extractFromPage).catch((err: Error) => {
              console.error(`DesignScout: DOM extraction failed — ${err.message}`);
              return null;
            });

            try {
              const html = await page.content();
              htmlPath = path.join(siteDir, 'page.html');
              fs.writeFileSync(htmlPath, html, 'utf-8');
            } catch { /* noop */ }
          }

          const { shots, capture } = await captureFrames(page, vp, siteDir, siteId);
          screenshots.push(...shots);
          if (isPrimary) {
            primaryCapture = capture;
            tagScreenshotSections(screenshots, sections as Section[], vp.height);
          }
        }

        // Layout issue detection for every viewport
        const raw: RawLayoutIssue[] = await page.evaluate(detectLayoutIssues).catch(() => []);
        for (const issue of raw) {
          layoutIssues.push({ viewportLabel: vp.label, device: vp.device, ...issue });
        }
        viewportMeta.push({
          label: vp.label,
          device: vp.device,
          width: vp.width,
          height: vp.height,
          pageHeight: await getPageHeight(page),
          issues: raw.length,
        });
      } finally {
        await context.close();
      }
    }

    const finalHeight = Number((primaryCapture?.pageHeight as number) || viewports[0].height);
    const primaryFrames = screenshots.filter(s => s.scrollPosition >= 0 && s.viewportLabel === viewports[0].label).length;
    const capturedPixels = primaryFrames * Number(primaryCapture?.captureStep || viewports[0].height);
    const coveragePercent = Math.min(100, Math.round((capturedPixels / Math.max(1, finalHeight)) * 100));

    const metadata = {
      ...basicMeta,
      extraction: primaryExtraction,
      sections,
      viewports: viewportMeta,
      layoutIssues,
      bannersDismissed,
      htmlPath,
      mode: options.selector ? `selector:${options.selector}` : 'full-page',
      capture: {
        ...(primaryCapture || {}),
        pageHeight: finalHeight,
        coveragePercent,
        responsive: viewports.length > 1,
        viewportCount: viewports.length,
      },
    };

    return {
      id: siteId,
      url: options.url,
      title,
      capturedAt: new Date().toISOString(),
      viewport: viewports.map(v => `${v.width}x${v.height}`).join(','),
      screenshots,
      metadata,
    };
  });
}

// ── viewport resolution ──

function resolveViewports(options: CaptureOptions, config: DesignScoutConfig): NamedViewport[] {
  if (options.viewports?.length) return options.viewports;
  if (options.viewport) {
    return [{
      ...options.viewport,
      label: `${options.viewport.width}x${options.viewport.height}`,
      device: deviceForWidth(options.viewport.width),
    }];
  }
  return [config.defaultViewport as NamedViewport];
}

// ── lazy content ──

async function triggerLazyContent(page: Page, vp: NamedViewport, scrollDelay: number, maxScrolls: number): Promise<void> {
  const scrollTo = (y: number) =>
    page.evaluate((v) => window.scrollTo({ top: v, behavior: 'instant' }), y).catch(() => {});

  await scrollTo(0);
  await page.waitForTimeout(300);

  let currentHeight = await getPageHeight(page);
  let stableCount = 0;
  let scrollY = 0;
  const scrollStep = vp.height * 0.7;
  const hardCap = vp.height * Math.max(20, maxScrolls * 4);

  while (stableCount < 3) {
    while (scrollY < currentHeight) {
      scrollY += scrollStep;
      await scrollTo(scrollY);
      await page.waitForTimeout(scrollDelay);
      await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
    }
    await page.waitForTimeout(700);
    const previousHeight = currentHeight;
    currentHeight = await getPageHeight(page);
    if (currentHeight === previousHeight) stableCount++;
    else stableCount = 0;
    if (scrollY > hardCap) break;
  }
}

// ── frame capture ──

async function captureFrames(
  page: Page,
  vp: NamedViewport,
  siteDir: string,
  siteId: string,
): Promise<{ shots: CapturedScreenshot[]; capture: Record<string, unknown> }> {
  const shots: CapturedScreenshot[] = [];
  const finalHeight = await getPageHeight(page);
  const scrollTo = (y: number) =>
    page.evaluate((v) => window.scrollTo({ top: v, behavior: 'instant' }), y).catch(() => {});

  await scrollTo(0);
  await page.waitForTimeout(400);

  const captureStep = Math.floor(vp.height * 0.8); // 20% overlap
  let captureY = 0;
  let frameIndex = 0;
  const prefix = vp.label.replace(/[^a-z0-9]+/gi, '-');
  // Pages that fit in one viewport only need a single frame.
  const singleFrame = finalHeight <= vp.height + 8;

  while (captureY < finalHeight) {
    await scrollTo(captureY);
    await page.waitForTimeout(220);

    const filepath = path.join(siteDir, `${prefix}_${String(frameIndex).padStart(3, '0')}.png`);
    await page.screenshot({ path: filepath, type: 'png' });
    shots.push({
      id: uuid(),
      siteId,
      scrollPosition: captureY,
      filepath,
      width: vp.width,
      height: vp.height,
      deviceType: vp.device,
      viewportLabel: vp.label,
    });

    frameIndex++;
    if (singleFrame) break;
    captureY += captureStep;

    if (captureY >= finalHeight && shots[shots.length - 1].scrollPosition < finalHeight - vp.height) {
      captureY = finalHeight - vp.height;
      if (captureY <= shots[shots.length - 1].scrollPosition) break;
    }
  }

  // Full-page reference shot (skip when a single frame already covers the page)
  try {
    if (singleFrame) throw new Error('skip');
    const fullPath = path.join(siteDir, `${prefix}_full.png`);
    await page.screenshot({ path: fullPath, fullPage: true, type: 'png' });
    shots.push({
      id: uuid(),
      siteId,
      scrollPosition: -1,
      filepath: fullPath,
      sectionLabel: 'full-page',
      width: vp.width,
      height: finalHeight,
      deviceType: vp.device,
      viewportLabel: vp.label,
    });
  } catch { /* tall pages can fail */ }

  return {
    shots,
    capture: {
      viewportHeight: vp.height,
      totalFrames: frameIndex,
      captureStep,
      overlapPercent: 20,
      pageHeight: finalHeight,
    },
  };
}

async function captureSelector(
  page: Page,
  selector: string,
  siteDir: string,
  siteId: string,
  vp: NamedViewport,
): Promise<CapturedScreenshot[]> {
  const shots: CapturedScreenshot[] = [];
  const handles = await page.$$(selector);
  if (handles.length === 0) {
    throw new Error(`Selector "${selector}" matched no elements on the page.`);
  }
  const prefix = vp.label.replace(/[^a-z0-9]+/gi, '-');
  for (let i = 0; i < Math.min(handles.length, 10); i++) {
    const el = handles[i];
    await el.scrollIntoViewIfNeeded().catch(() => {});
    const box = await el.boundingBox();
    const filepath = path.join(siteDir, `${prefix}_sel_${String(i).padStart(2, '0')}.png`);
    try {
      await el.screenshot({ path: filepath, type: 'png' });
      shots.push({
        id: uuid(),
        siteId,
        scrollPosition: Math.round(box?.y ?? 0),
        filepath,
        sectionLabel: `${selector} [${i}]`,
        width: Math.round(box?.width ?? vp.width),
        height: Math.round(box?.height ?? vp.height),
        deviceType: vp.device,
        viewportLabel: vp.label,
      });
    } catch { /* element not visible */ }
  }
  return shots;
}

// ── section detection ──

interface Section {
  tag: string;
  id: string;
  className: string;
  top: number;
  bottom: number;
  text: string;
}

async function detectSections(page: Page): Promise<Section[]> {
  return page.evaluate(() => {
    const landmarks: Section[] = [];
    const sectionEls = document.querySelectorAll(
      'section, header, footer, main, nav, [role="banner"], [role="main"], [role="contentinfo"], [role="navigation"], article, aside',
    );
    for (const el of Array.from(sectionEls)) {
      const rect = el.getBoundingClientRect();
      const scrollTop = window.scrollY;
      landmarks.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        className: el.className?.toString().slice(0, 80) || '',
        top: rect.top + scrollTop,
        bottom: rect.bottom + scrollTop,
        text: (el.querySelector('h1, h2, h3')?.textContent || '').trim().slice(0, 60),
      });
    }
    return landmarks;
  });
}

function tagScreenshotSections(screenshots: CapturedScreenshot[], sections: Section[], viewportHeight: number): void {
  for (const shot of screenshots) {
    if (shot.scrollPosition < 0 || shot.sectionLabel) continue;
    const top = shot.scrollPosition;
    const bottom = top + viewportHeight;
    const matched = sections.filter(s => s.top < bottom && s.bottom > top);
    if (matched.length > 0) {
      const primary = matched[0];
      shot.sectionLabel = primary.tag
        + (primary.id ? `#${primary.id}` : '')
        + (primary.text ? `: ${primary.text}` : '');
    }
  }
}

/**
 * Light single-shot full-page capture (used by the crawler / quick previews).
 */
export async function captureFullPage(
  url: string,
  outputPath: string,
  viewport = { width: 1440, height: 900 },
): Promise<void> {
  await withBrowser(async (browser) => {
    const context = await newContext(browser, viewport);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: outputPath, fullPage: true, type: 'png' });
    await context.close();
  });
}
