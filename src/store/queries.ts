import type Database from 'better-sqlite3';
import type {
  CapturedSite,
  CapturedScreenshot,
  DesignPattern,
  DesignTokenSet,
} from '../shared/types.js';

// ── Sites ──

export function insertSite(db: Database.Database, site: Omit<CapturedSite, 'screenshots'>): void {
  db.prepare(`
    INSERT OR REPLACE INTO sites (id, url, title, captured_at, viewport, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    site.id,
    site.url,
    site.title,
    site.capturedAt,
    site.viewport,
    site.metadata ? JSON.stringify(site.metadata) : null,
  );
}

export function getSite(db: Database.Database, id: string): CapturedSite | null {
  const row = db.prepare('SELECT * FROM sites WHERE id = ?').get(id) as any;
  if (!row) return null;

  const screenshots = getScreenshotsForSite(db, id);
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    capturedAt: row.captured_at,
    viewport: row.viewport,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    screenshots,
  };
}

export function listSites(db: Database.Database, limit = 50): CapturedSite[] {
  const rows = db.prepare('SELECT * FROM sites ORDER BY captured_at DESC LIMIT ?').all(limit) as any[];
  return rows.map(row => ({
    id: row.id,
    url: row.url,
    title: row.title,
    capturedAt: row.captured_at,
    viewport: row.viewport,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    screenshots: getScreenshotsForSite(db, row.id),
  }));
}

export function findSiteByUrl(db: Database.Database, url: string): CapturedSite | null {
  const row = db.prepare('SELECT * FROM sites WHERE url = ? ORDER BY captured_at DESC LIMIT 1').get(url) as any;
  if (!row) return null;
  return getSite(db, row.id);
}

// ── Screenshots ──

export function insertScreenshot(db: Database.Database, screenshot: CapturedScreenshot): void {
  db.prepare(`
    INSERT OR REPLACE INTO screenshots (id, site_id, scroll_position, filepath, section_label, width, height)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    screenshot.id,
    screenshot.siteId,
    screenshot.scrollPosition,
    screenshot.filepath,
    screenshot.sectionLabel || null,
    screenshot.width,
    screenshot.height,
  );
}

export function getScreenshotsForSite(db: Database.Database, siteId: string): CapturedScreenshot[] {
  const rows = db.prepare('SELECT * FROM screenshots WHERE site_id = ? ORDER BY scroll_position ASC').all(siteId) as any[];
  return rows.map(row => ({
    id: row.id,
    siteId: row.site_id,
    scrollPosition: row.scroll_position,
    filepath: row.filepath,
    sectionLabel: row.section_label,
    width: row.width,
    height: row.height,
  }));
}

// ── Patterns ──

export function insertPattern(db: Database.Database, pattern: DesignPattern): void {
  db.prepare(`
    INSERT OR REPLACE INTO patterns (id, site_id, category, subcategory, data, description, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    pattern.id,
    pattern.siteId,
    pattern.category,
    pattern.subcategory || null,
    JSON.stringify(pattern.data),
    pattern.description,
    pattern.confidence,
  );
}

export function getPatternsForSite(db: Database.Database, siteId: string): DesignPattern[] {
  const rows = db.prepare('SELECT * FROM patterns WHERE site_id = ?').all(siteId) as any[];
  return rows.map(parsePatternRow);
}

export function searchPatterns(db: Database.Database, query: string, category?: string): DesignPattern[] {
  let sql = 'SELECT * FROM patterns WHERE description LIKE ?';
  const params: any[] = [`%${query}%`];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  sql += ' ORDER BY confidence DESC LIMIT 50';
  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map(parsePatternRow);
}

export function getPatternsByCategory(db: Database.Database, category: string): DesignPattern[] {
  const rows = db.prepare('SELECT * FROM patterns WHERE category = ? ORDER BY confidence DESC').all(category) as any[];
  return rows.map(parsePatternRow);
}

function parsePatternRow(row: any): DesignPattern {
  return {
    id: row.id,
    siteId: row.site_id,
    category: row.category,
    subcategory: row.subcategory,
    data: JSON.parse(row.data),
    description: row.description,
    confidence: row.confidence,
  };
}

// ── Tokens ──

export function insertTokens(db: Database.Database, id: string, siteId: string | null, tokens: DesignTokenSet, format = 'json'): void {
  db.prepare(`
    INSERT OR REPLACE INTO tokens (id, site_id, token_set, format)
    VALUES (?, ?, ?, ?)
  `).run(id, siteId, JSON.stringify(tokens), format);
}

export function getTokensForSite(db: Database.Database, siteId: string): DesignTokenSet | null {
  const row = db.prepare('SELECT * FROM tokens WHERE site_id = ? ORDER BY generated_at DESC LIMIT 1').get(siteId) as any;
  if (!row) return null;
  return JSON.parse(row.token_set);
}

export function getLatestTokens(db: Database.Database): DesignTokenSet | null {
  const row = db.prepare('SELECT * FROM tokens ORDER BY generated_at DESC LIMIT 1').get() as any;
  if (!row) return null;
  return JSON.parse(row.token_set);
}
