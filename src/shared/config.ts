import path from 'node:path';
import fs from 'node:fs';
import type { DesignScoutConfig, NamedViewport, DeviceType } from './types.js';

const HOME = process.env.HOME || process.env.USERPROFILE || '/tmp';
const DATA_ROOT = process.env.DESIGNSCOUT_DATA || path.join(HOME, '.designscout');

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const VIEWPORT_PRESETS: Record<DeviceType, NamedViewport> = {
  mobile: { label: 'mobile', device: 'mobile', width: 390, height: 844 },
  tablet: { label: 'tablet', device: 'tablet', width: 834, height: 1112 },
  desktop: { label: 'desktop', device: 'desktop', width: 1440, height: 900 },
};

/** Parse "WIDTHxHEIGHT" into a viewport, or return null. */
export function parseViewport(spec: string | undefined): { width: number; height: number } | null {
  if (!spec) return null;
  const m = spec.trim().toLowerCase().match(/^(\d{2,5})\s*x\s*(\d{2,5})$/);
  if (!m) return null;
  return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
}

/** Resolve a device keyword or "WxH" spec to a NamedViewport. */
export function resolveViewport(spec: string): NamedViewport {
  const key = spec.trim().toLowerCase() as DeviceType;
  if (key in VIEWPORT_PRESETS) return VIEWPORT_PRESETS[key];
  const parsed = parseViewport(spec);
  if (parsed) return { ...parsed, label: spec, device: deviceForWidth(parsed.width) };
  return VIEWPORT_PRESETS.desktop;
}

export function deviceForWidth(width: number): DeviceType {
  if (width <= 520) return 'mobile';
  if (width <= 1024) return 'tablet';
  return 'desktop';
}

export function getConfig(overrides: Partial<DesignScoutConfig> = {}): DesignScoutConfig {
  const config: DesignScoutConfig = {
    dataDir: DATA_ROOT,
    screenshotsDir: path.join(DATA_ROOT, 'screenshots'),
    outputsDir: path.join(DATA_ROOT, 'outputs'),
    defaultViewport: VIEWPORT_PRESETS.desktop,
    defaultScrollDelay: envInt('DESIGNSCOUT_SCROLL_DELAY', 400),
    defaultScreenshotInterval: 900, // px
    maxScrolls: envInt('DESIGNSCOUT_MAX_SCROLLS', 30),
    captureRetries: envInt('DESIGNSCOUT_RETRIES', 2),
    navTimeoutMs: envInt('DESIGNSCOUT_NAV_TIMEOUT', 45_000),
    crawlMaxPages: envInt('DESIGNSCOUT_CRAWL_MAX_PAGES', 20),
    crawlMaxDepth: envInt('DESIGNSCOUT_CRAWL_MAX_DEPTH', 2),
    viewportPresets: VIEWPORT_PRESETS,
    ...overrides,
  };

  // Ensure directories exist
  for (const dir of [config.dataDir, config.screenshotsDir, config.outputsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return config;
}

export function dbPath(config: DesignScoutConfig): string {
  return path.join(config.dataDir, 'designscout.db');
}
