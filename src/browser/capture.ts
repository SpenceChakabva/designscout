import { chromium, type Browser, type Page } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { v4 as uuid } from 'uuid';
import type { CaptureOptions, CapturedSite, CapturedScreenshot, DesignScoutConfig } from '../shared/types.js';

/**
 * Capture a site by scrolling the full page, handling lazy content,
 * and verifying coverage. No artificial limits — scrolls until the
 * page is fully captured.
 */
export async function captureSite(
  options: CaptureOptions,
  config: DesignScoutConfig,
): Promise<CapturedSite> {
  const viewport = options.viewport ?? config.defaultViewport;
  const scrollDelay = options.scrollDelay ?? config.defaultScrollDelay;
  const maxScrolls = options.maxScrolls ?? config.maxScrolls;

  const siteId = uuid();
  const siteDir = path.join(config.screenshotsDir, siteId);
  fs.mkdirSync(siteDir, { recursive: true });

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      userAgent: 'DesignScout/0.1 (design-research-agent)',
    });

    const page = await context.newPage();

    // Navigate and wait for full load
    await page.goto(options.url, { waitUntil: 'networkidle', timeout: 45_000 });
    await page.waitForTimeout(2000);

    const title = await page.title();
    const screenshots: CapturedScreenshot[] = [];

    // ── Phase 1: Scroll the full page to trigger all lazy content ──
    // Scroll slowly from top to bottom so all intersection observers,
    // lazy images, and dynamic sections load.
    let previousHeight = 0;
    let currentHeight = await getPageHeight(page);
    let stableCount = 0;

    // First pass: scroll to bottom to trigger all lazy loading
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);

    let scrollY = 0;
    const scrollStep = viewport.height * 0.7; // overlap viewports by 30%

    while (stableCount < 3) {
      // Scroll in viewport-sized steps
      while (scrollY < currentHeight) {
        scrollY += scrollStep;
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), scrollY);
        await page.waitForTimeout(scrollDelay);

        // Wait for network to settle after each scroll (lazy images, etc.)
        try {
          await page.waitForLoadState('networkidle', { timeout: 2000 });
        } catch {
          // Timeout is fine — some pages have persistent connections
        }
      }

      // Check if the page grew (infinite scroll, lazy sections)
      await page.waitForTimeout(800);
      previousHeight = currentHeight;
      currentHeight = await getPageHeight(page);

      if (currentHeight === previousHeight) {
        stableCount++;
      } else {
        stableCount = 0; // page is still growing, keep scrolling
      }

      // Safety limit: 200 viewport heights is enough for any page
      if (scrollY > viewport.height * 200) break;
    }

    // Final page height after all content loaded
    const finalHeight = await getPageHeight(page);

    // ── Phase 2: Scroll back to top and capture every section ──
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    // Capture with overlap so no section is missed.
    // Step by 80% of viewport height to guarantee 20% overlap between frames.
    const captureStep = Math.floor(viewport.height * 0.8);
    let captureY = 0;
    let frameIndex = 0;

    while (captureY < finalHeight) {
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), captureY);
      await page.waitForTimeout(250);

      const screenshotPath = path.join(siteDir, `viewport_${String(frameIndex).padStart(3, '0')}.png`);
      await page.screenshot({ path: screenshotPath, type: 'png' });

      screenshots.push({
        id: uuid(),
        siteId,
        scrollPosition: captureY,
        filepath: screenshotPath,
        width: viewport.width,
        height: viewport.height,
      });

      frameIndex++;
      captureY += captureStep;

      // If we've passed the bottom, do one final capture at the very bottom
      if (captureY >= finalHeight && screenshots[screenshots.length - 1].scrollPosition < finalHeight - viewport.height) {
        captureY = finalHeight - viewport.height;
        // Prevent infinite loop
        if (captureY <= screenshots[screenshots.length - 1].scrollPosition) break;
      }
    }

    // ── Phase 3: Full-page screenshot for reference ──
    const fullPagePath = path.join(siteDir, 'full_page.png');
    try {
      await page.screenshot({ path: fullPagePath, fullPage: true, type: 'png' });
      screenshots.push({
        id: uuid(),
        siteId,
        scrollPosition: -1,
        filepath: fullPagePath,
        sectionLabel: 'full-page',
        width: viewport.width,
        height: finalHeight,
      });
    } catch {
      // Full-page can fail on very tall pages
    }

    // ── Phase 4: Section detection via DOM landmarks ──
    // Identify semantic sections and tag screenshots with their content
    const sections = await page.evaluate(() => {
      const landmarks: { tag: string; id: string; className: string; top: number; bottom: number; text: string }[] = [];
      const sectionEls = document.querySelectorAll(
        'section, header, footer, main, nav, [role="banner"], [role="main"], [role="contentinfo"], [role="navigation"], article, aside'
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

    // Tag each screenshot with the section it covers
    for (const shot of screenshots) {
      if (shot.scrollPosition < 0) continue; // skip full-page
      const shotTop = shot.scrollPosition;
      const shotBottom = shotTop + viewport.height;
      const matchedSections = sections.filter(s => s.top < shotBottom && s.bottom > shotTop);
      if (matchedSections.length > 0) {
        const primary = matchedSections[0];
        shot.sectionLabel = primary.tag
          + (primary.id ? `#${primary.id}` : '')
          + (primary.text ? `: ${primary.text}` : '');
      }
    }

    // ── Phase 5: DOM style extraction ──
    const basicMeta = await page.evaluate(() => {
      const meta: Record<string, string> = {};
      document.querySelectorAll('meta').forEach((el) => {
        const name = el.getAttribute('name') || el.getAttribute('property') || '';
        const content = el.getAttribute('content') || '';
        if (name && content) meta[name] = content;
      });
      return { meta, bodyClasses: document.body.className };
    });

    const { extractFromPage } = await import('./extract.js');
    let domExtraction;
    try {
      domExtraction = await page.evaluate(extractFromPage);
    } catch {
      domExtraction = null;
    }

    // ── Coverage verification ──
    const capturedPixels = screenshots.filter(s => s.scrollPosition >= 0).length * captureStep;
    const coveragePercent = Math.min(100, Math.round((capturedPixels / finalHeight) * 100));

    const metadata = {
      ...basicMeta,
      extraction: domExtraction,
      sections,
      capture: {
        pageHeight: finalHeight,
        viewportHeight: viewport.height,
        totalFrames: screenshots.filter(s => s.scrollPosition >= 0).length,
        captureStep,
        overlapPercent: 20,
        coveragePercent,
        lazyContentPasses: stableCount,
      },
    };

    return {
      id: siteId,
      url: options.url,
      title,
      capturedAt: new Date().toISOString(),
      viewport: `${viewport.width}x${viewport.height}`,
      screenshots,
      metadata,
    };
  } finally {
    if (browser) await browser.close();
  }
}

async function getPageHeight(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(
    document.documentElement.scrollHeight,
    document.body.scrollHeight,
    document.documentElement.offsetHeight,
    document.body.offsetHeight,
  ));
}

/**
 * Light single-shot full-page capture.
 */
export async function captureFullPage(
  url: string,
  outputPath: string,
  viewport = { width: 1440, height: 900 },
): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: outputPath, fullPage: true, type: 'png' });
  } finally {
    await browser.close();
  }
}
