import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Viewport } from '../shared/types.js';

const UA = 'DesignScout/0.2 (design-research-agent; +https://github.com/SpenceChakabva/designscout)';

/** Run a callback with a fresh headless Chromium browser, always closed afterward. */
export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await chromium.launch({ headless: true });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

export async function newContext(browser: Browser, viewport: Viewport): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    userAgent: UA,
    // A realistic-ish locale so consent banners render in English.
    locale: 'en-US',
  });
  // When run through tsx/esbuild, module-level functions passed to
  // page.evaluate() carry a __name() helper call that does not exist in the
  // browser. Shim it so serialized extractors run under both tsc and tsx.
  await context.addInitScript(() => {
    // @ts-expect-error - browser global
    globalThis.__name = globalThis.__name || ((fn: unknown) => fn);
  });
  return context;
}

/** Navigate with retries and exponential backoff. Returns the page title. */
export async function gotoWithRetry(
  page: Page,
  url: string,
  opts: { timeoutMs: number; retries: number },
): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
      // Best-effort settle; networkidle often never fires on live sites.
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1200);
      return await page.title();
    } catch (err) {
      lastErr = err;
      if (attempt < opts.retries) {
        await page.waitForTimeout(1000 * 2 ** attempt);
      }
    }
  }
  throw new Error(`Failed to load ${url} after ${opts.retries + 1} attempt(s): ${(lastErr as Error)?.message}`);
}

/** Best-effort dismissal of cookie / consent / newsletter overlays. */
export async function dismissOverlays(page: Page): Promise<number> {
  return page.evaluate(() => {
    let removed = 0;
    const labels = new Set([
      'accept all', 'accept all cookies', 'accept cookies', 'i agree', 'agree',
      'got it', 'ok', 'okay', 'allow all', 'accept', 'continue', 'dismiss',
      'no thanks', 'allow all cookies', 'that\'s ok', 'i accept',
    ]);
    // Only click real buttons — never <a>, which navigate.
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], input[type="button"], input[type="submit"]'));
    for (const btn of buttons) {
      const text = (btn.textContent || (btn as HTMLInputElement).value || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const inConsent = !!btn.closest('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[aria-modal="true"],[role="dialog"]');
      if (text && text.length < 25 && labels.has(text) && (inConsent || labels.has(text))) {
        try { btn.click(); removed++; } catch { /* detached */ }
        if (removed >= 2) break;
      }
    }
    // Nuke obvious fixed-position consent shells that survived.
    const killSelectors = [
      '[id*="cookie" i]', '[class*="cookie" i]', '[id*="consent" i]', '[class*="consent" i]',
      '[class*="gdpr" i]', '[aria-label*="cookie" i]', '#onetrust-consent-sdk', '.cky-consent-container',
    ];
    for (const sel of killSelectors) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const style = getComputedStyle(el as Element);
        if (style.position === 'fixed' || style.position === 'sticky') {
          (el as HTMLElement).remove();
          removed++;
        }
      }
    }
    // Restore scroll if a banner locked it.
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    return removed;
  }).catch(() => 0);
}

export async function getPageHeight(page: Page): Promise<number> {
  try {
    return await page.evaluate(() => Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0,
      document.documentElement.offsetHeight,
      document.body?.offsetHeight ?? 0,
    ));
  } catch {
    return page.viewportSize()?.height ?? 900;
  }
}
