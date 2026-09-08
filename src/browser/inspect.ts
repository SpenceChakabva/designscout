import type { Page } from 'playwright';
import type { DesignScoutConfig, Viewport } from '../shared/types.js';
import { withBrowser, newContext, gotoWithRetry, dismissOverlays, getPageHeight } from './session.js';

/**
 * Load a URL once and run one or more in-page evaluate callbacks against it.
 * Used by scout_inventory / scout_a11y which need the live DOM, not a screenshot.
 */
export async function inspectPage<T>(
  url: string,
  config: DesignScoutConfig,
  evaluators: ((page: Page) => Promise<T>),
  opts: { viewport?: Viewport; scroll?: boolean } = {},
): Promise<T> {
  const viewport = opts.viewport ?? { width: config.defaultViewport.width, height: config.defaultViewport.height };
  return withBrowser(async (browser) => {
    const context = await newContext(browser, viewport);
    const page = await context.newPage();
    try {
      await gotoWithRetry(page, url, { timeoutMs: config.navTimeoutMs, retries: config.captureRetries });
      await dismissOverlays(page).catch(() => {});
      await page.waitForTimeout(300);
      if (opts.scroll !== false) {
        const height = await getPageHeight(page);
        for (let y = 0; y < height; y += 700) {
          await page.evaluate((v) => window.scrollTo(0, v), y);
          await page.waitForTimeout(100);
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(150);
      }
      return await evaluators(page);
    } finally {
      await context.close();
    }
  });
}
