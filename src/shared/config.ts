import path from 'node:path';
import fs from 'node:fs';
import type { DesignScoutConfig } from './types.js';

const HOME = process.env.HOME || process.env.USERPROFILE || '/tmp';
const DATA_ROOT = process.env.DESIGNSCOUT_DATA || path.join(HOME, '.designscout');

export function getConfig(overrides: Partial<DesignScoutConfig> = {}): DesignScoutConfig {
  const config: DesignScoutConfig = {
    dataDir: DATA_ROOT,
    screenshotsDir: path.join(DATA_ROOT, 'screenshots'),
    outputsDir: path.join(DATA_ROOT, 'outputs'),
    defaultViewport: { width: 1440, height: 900 },
    defaultScrollDelay: 400,
    defaultScreenshotInterval: 900, // px
    maxScrolls: 30,
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
