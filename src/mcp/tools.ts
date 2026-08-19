import type { DesignScoutConfig, DesignAnalysis } from '../shared/types.js';
import { getDb } from '../store/db.js';
import * as queries from '../store/queries.js';
import { captureSite } from '../browser/capture.js';
import { ANALYSIS_SCHEMA, selectScreenshots, extractPatterns } from '../analyzer/vision.js';
import { generateTokens, formatTokens } from '../outputs/tokens.js';
import { buildMoodBoardEntry, generateMoodBoard } from '../outputs/moodboard.js';
import { generateDesignMd } from '../outputs/designmd.js';
import { runAudit, auditTokens, auditCopy, extractTextFromHtml, type Finding } from '../audit/rules.js';
import { v4 as uuid } from 'uuid';
import fs from 'node:fs';
import type { TokenFormat } from '../shared/types.js';

// All tools return plain text — no base64 images over stdio.
type ToolResult = { content: { type: 'text'; text: string }[] };

function textResult(data: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/**
 * scout_capture — Visit a URL, scroll through, take screenshots.
 * Returns file paths to screenshots so Claude Code can read them.
 */
export async function handleCapture(
  args: { url: string; viewport?: string; scroll_delay?: number; max_scrolls?: number },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);

  let viewport = config.defaultViewport;
  if (args.viewport) {
    const [w, h] = args.viewport.split('x').map(Number);
    if (w && h) viewport = { width: w, height: h };
  }

  const site = await captureSite(
    { url: args.url, viewport, scrollDelay: args.scroll_delay, maxScrolls: args.max_scrolls },
    config,
  );

  // Store site and screenshots
  queries.insertSite(db, {
    id: site.id,
    url: site.url,
    title: site.title,
    capturedAt: site.capturedAt,
    viewport: site.viewport,
    metadata: site.metadata,
  });

  for (const screenshot of site.screenshots) {
    queries.insertScreenshot(db, screenshot);
  }

  // Return file paths — Claude Code reads the files itself
  const selected = selectScreenshots(site.screenshots, 4);

  return textResult({
    success: true,
    siteId: site.id,
    url: site.url,
    title: site.title,
    screenshotCount: site.screenshots.length,
    viewport: site.viewport,
    screenshots: selected.map(s => ({
      filepath: s.filepath,
      scrollPosition: s.scrollPosition,
      sectionLabel: s.sectionLabel || null,
    })),
    allScreenshotPaths: site.screenshots.map(s => s.filepath),
    extraction: (site.metadata as any)?.extraction || null,
    sections: (site.metadata as any)?.sections || [],
    capture: (site.metadata as any)?.capture || null,
    message: `Captured ${site.screenshots.length} screenshots of "${site.title}" (${((site.metadata as any)?.capture?.coveragePercent) || '?'}% page coverage, ${((site.metadata as any)?.sections?.length) || 0} sections detected). Screenshot files, extracted styles (colors, fonts, icons, animations), and section map are included. Read the screenshots for visual analysis, then call scout_store_patterns with siteId "${site.id}".`,
  });
}

/**
 * scout_analyze — Return screenshot paths + analysis schema.
 * Claude Code reads the image files and does the visual analysis itself.
 */
export async function handleAnalyze(
  args: { site_id?: string; url?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);

  let siteId = args.site_id;
  if (!siteId && args.url) {
    const site = queries.findSiteByUrl(db, args.url);
    if (!site) return textResult({ success: false, error: `No captured site found for URL: ${args.url}. Run scout_capture first.` });
    siteId = site.id;
  }
  if (!siteId) return textResult({ success: false, error: 'Provide either site_id or url.' });

  const site = queries.getSite(db, siteId);
  if (!site) return textResult({ success: false, error: `Site ${siteId} not found.` });

  const selected = selectScreenshots(site.screenshots, 6);

  return textResult({
    success: true,
    siteId,
    url: site.url,
    title: site.title,
    screenshotPaths: selected.map(s => s.filepath),
    analysisSchema: ANALYSIS_SCHEMA,
    message: `Read the screenshot files listed above to visually analyze the design of "${site.title}". For each screenshot, extract design information matching the schema. Then call scout_store_patterns with siteId "${siteId}" and a JSON array of your analyses.`,
  });
}

/**
 * scout_store_patterns — Claude Code sends back its analysis, we extract and store patterns.
 */
export async function handleStorePatterns(
  args: { site_id: string; analyses: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);

  let parsedAnalyses: DesignAnalysis[];
  try {
    const cleaned = args.analyses.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsedAnalyses = JSON.parse(cleaned);
    if (!Array.isArray(parsedAnalyses)) parsedAnalyses = [parsedAnalyses];
  } catch (err) {
    return textResult({ success: false, error: `Failed to parse analyses JSON: ${(err as Error).message}` });
  }

  const patterns = extractPatterns(parsedAnalyses, args.site_id);

  for (const pattern of patterns) {
    queries.insertPattern(db, pattern);
  }

  return textResult({
    success: true,
    siteId: args.site_id,
    patternsStored: patterns.length,
    patterns: patterns.map(p => ({ category: p.category, subcategory: p.subcategory, description: p.description })),
    message: `Stored ${patterns.length} design patterns. Use scout_tokens to generate tokens, scout_search to query patterns, or scout_moodboard for a visual summary.`,
  });
}

/**
 * scout_search — Query the inspiration database.
 */
export async function handleSearch(
  args: { query: string; category?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  const patterns = queries.searchPatterns(db, args.query, args.category);

  if (patterns.length === 0) {
    return textResult({ success: true, results: [], message: `No patterns found matching "${args.query}".` });
  }

  const bySite: Record<string, { url: string; patterns: typeof patterns }> = {};
  for (const p of patterns) {
    const site = queries.getSite(db, p.siteId);
    const url = site?.url || 'unknown';
    if (!bySite[p.siteId]) bySite[p.siteId] = { url, patterns: [] };
    bySite[p.siteId].patterns.push(p);
  }

  return textResult({
    success: true,
    totalResults: patterns.length,
    sites: Object.entries(bySite).map(([siteId, data]) => ({
      siteId,
      url: data.url,
      matchingPatterns: data.patterns.map(p => ({
        category: p.category,
        subcategory: p.subcategory,
        description: p.description,
        confidence: p.confidence,
        data: p.data,
      })),
    })),
  });
}

/**
 * scout_tokens — Generate design tokens from analyzed patterns.
 */
export async function handleTokens(
  args: { site_id?: string; format?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  const format = (args.format as TokenFormat) || 'json';

  let patterns;
  if (args.site_id) {
    patterns = queries.getPatternsForSite(db, args.site_id);
  } else {
    const sites = queries.listSites(db, 5);
    patterns = sites.flatMap(s => queries.getPatternsForSite(db, s.id));
  }

  if (patterns.length === 0) {
    return textResult({ success: false, error: 'No patterns found. Run scout_capture and scout_analyze first.' });
  }

  const tokens = generateTokens(patterns);
  tokens.id = uuid();
  queries.insertTokens(db, tokens.id, args.site_id || null, tokens, format);

  const formatted = formatTokens(tokens, format);

  return textResult({
    success: true,
    format,
    tokens: format === 'json' ? tokens : undefined,
    formatted: format !== 'json' ? formatted : undefined,
    message: `Generated ${format} design tokens from ${patterns.length} patterns.`,
  });
}

/**
 * scout_moodboard — Generate an HTML mood board.
 */
export async function handleMoodBoard(
  args: { title?: string; site_ids?: string[]; brief?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  const title = args.title || 'Design Inspiration';

  let sites;
  if (args.site_ids?.length) {
    sites = args.site_ids.map(id => queries.getSite(db, id)).filter(Boolean);
  } else {
    sites = queries.listSites(db, 10);
  }

  if (sites.length === 0) {
    return textResult({ success: false, error: 'No sites found. Run scout_capture first.' });
  }

  const entries = sites.map(site => {
    const patterns = queries.getPatternsForSite(db, site!.id);
    const tokens = queries.getTokensForSite(db, site!.id) || undefined;
    return buildMoodBoardEntry(site!.url, site!.title, site!.screenshots, patterns, tokens);
  });

  const outputPath = generateMoodBoard(entries, title, config, args.brief);

  return textResult({
    success: true,
    outputPath,
    siteCount: entries.length,
    message: `Generated mood board with ${entries.length} sites at: ${outputPath}`,
  });
}

/**
 * scout_compare — Return screenshot paths + patterns for comparison.
 */
export async function handleCompare(
  args: { site_ids?: string[]; urls?: string[] },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  let siteIds = args.site_ids || [];

  if (args.urls?.length) {
    for (const url of args.urls) {
      const site = queries.findSiteByUrl(db, url);
      if (site) siteIds.push(site.id);
    }
  }

  if (siteIds.length < 2) {
    return textResult({ success: false, error: 'Need at least 2 captured sites to compare.' });
  }

  const siteData = siteIds.map(id => {
    const site = queries.getSite(db, id);
    if (!site) return null;
    const patterns = queries.getPatternsForSite(db, id);
    const selected = selectScreenshots(site.screenshots, 2);
    return {
      siteId: id,
      url: site.url,
      title: site.title,
      screenshotPaths: selected.map(s => s.filepath),
      patterns: patterns.map(p => ({ category: p.category, subcategory: p.subcategory, description: p.description })),
    };
  }).filter(Boolean);

  return textResult({
    success: true,
    sitesCompared: siteData.length,
    sites: siteData,
    message: `Read the screenshot files for each site to visually compare their designs. Pattern data is included for reference.`,
  });
}

/**
 * scout_audit — Run anti-pattern detection on files, tokens, or copy.
 * Deterministic rules, no LLM needed. Catches AI design and copy tells.
 */
export async function handleAudit(
  args: { file_path?: string; text?: string; site_id?: string; check?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const allFindings: Finding[] = [];

  // Audit a file
  if (args.file_path) {
    try {
      const content = fs.readFileSync(args.file_path, 'utf-8');
      const isHtml = args.file_path.match(/\.(html?|jsx|tsx|vue|svelte|astro)$/i);

      if (isHtml) {
        const text = extractTextFromHtml(content);
        // Run copy audit on extracted text
        allFindings.push(...auditCopy(text));
        // Run design audit by extracting colors and fonts from CSS/HTML
        const colorMatches = content.match(/#[0-9a-fA-F]{6}\b/g) || [];
        const fontMatches = content.match(/font-family:\s*([^;}\n]+)/gi) || [];
        const fonts = fontMatches.flatMap(m =>
          m.replace(/font-family:\s*/i, '').split(',').map(f => f.trim().replace(/['"]/g, ''))
        );
        allFindings.push(...runAudit({
          html: content,
          css: content,
          text,
          colors: [...new Set(colorMatches)],
          fonts: [...new Set(fonts)],
          backgroundColors: colorMatches.filter((_, i) => {
            const ctx = content.substring(Math.max(0, content.indexOf(colorMatches[i]) - 30), content.indexOf(colorMatches[i]));
            return /background|bg/i.test(ctx);
          }),
        }));
      } else {
        // Plain text or CSS
        allFindings.push(...auditCopy(content));
      }
    } catch (err) {
      return textResult({ success: false, error: `Failed to read file: ${(err as Error).message}` });
    }
  }

  // Audit raw text/copy
  if (args.text) {
    allFindings.push(...auditCopy(args.text));
  }

  // Audit stored tokens for a site
  if (args.site_id) {
    const db = getDb(config);
    const tokens = queries.getTokensForSite(db, args.site_id);
    if (tokens) {
      allFindings.push(...auditTokens(tokens));
    } else {
      const patterns = queries.getPatternsForSite(db, args.site_id);
      if (patterns.length > 0) {
        const tokens = generateTokens(patterns);
        allFindings.push(...auditTokens(tokens));
      }
    }
  }

  // Filter by check type if specified
  const filtered = args.check
    ? allFindings.filter(f => f.category === args.check || f.ruleId === args.check)
    : allFindings;

  // Deduplicate by ruleId + snippet
  const seen = new Set<string>();
  const deduped = filtered.filter(f => {
    const key = `${f.ruleId}:${f.snippet || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const summary = {
    total: deduped.length,
    errors: deduped.filter(f => f.severity === 'error').length,
    warnings: deduped.filter(f => f.severity === 'warning').length,
    advisories: deduped.filter(f => f.severity === 'advisory').length,
    byCategory: {
      slop: deduped.filter(f => f.category === 'slop').length,
      copy: deduped.filter(f => f.category === 'copy').length,
      quality: deduped.filter(f => f.category === 'quality').length,
    },
  };

  return textResult({
    success: true,
    summary,
    findings: deduped.map(f => ({
      rule: f.ruleId,
      category: f.category,
      severity: f.severity,
      name: f.name,
      description: f.description,
      snippet: f.snippet,
      fix: f.fix,
    })),
    clean: deduped.length === 0,
    message: deduped.length === 0
      ? 'Clean. No anti-patterns or AI tells detected.'
      : `Found ${deduped.length} issue(s): ${summary.byCategory.slop} design slop, ${summary.byCategory.copy} copy tells, ${summary.byCategory.quality} quality issues. Fix them before shipping.`,
  });
}

/**
 * scout_designmd — Generate a DESIGN.md from captured patterns.
 * Compatible with impeccable's format.
 */
export async function handleDesignMd(
  args: { site_id?: string; name?: string; output_path?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);

  let patterns;
  let siteName = args.name || 'Untitled';

  if (args.site_id) {
    const site = queries.getSite(db, args.site_id);
    if (!site) return textResult({ success: false, error: `Site ${args.site_id} not found.` });
    patterns = queries.getPatternsForSite(db, args.site_id);
    siteName = args.name || site.title || site.url;
  } else {
    const sites = queries.listSites(db, 5);
    patterns = sites.flatMap(s => queries.getPatternsForSite(db, s.id));
    if (sites.length === 1) siteName = args.name || sites[0].title || sites[0].url;
  }

  if (patterns.length === 0) {
    return textResult({ success: false, error: 'No patterns found. Run scout_capture and scout_analyze first.' });
  }

  const tokens = generateTokens(patterns);
  tokens.id = uuid();
  const markdown = generateDesignMd(siteName, patterns, tokens);

  // Write to file
  const outputPath = args.output_path || 'DESIGN.md';
  try {
    fs.writeFileSync(outputPath, markdown, 'utf-8');
  } catch {
    // If we can't write to the requested path, return the content instead
    return textResult({
      success: true,
      content: markdown,
      message: `Generated DESIGN.md (could not write to ${outputPath}, content returned inline).`,
    });
  }

  return textResult({
    success: true,
    outputPath,
    patternCount: patterns.length,
    message: `Generated DESIGN.md at ${outputPath} from ${patterns.length} patterns. This file is compatible with impeccable — any AI coding tool can read it.`,
  });
}

/**
 * scout_styles — Generate 3 distinct design direction mockups from captured patterns.
 * The user picks one, then Claude Code builds from that direction.
 */
export async function handleStyles(
  args: { site_id?: string; brief?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);

  let patterns;
  if (args.site_id) {
    patterns = queries.getPatternsForSite(db, args.site_id);
  } else {
    const sites = queries.listSites(db, 5);
    patterns = sites.flatMap(s => queries.getPatternsForSite(db, s.id));
  }

  if (patterns.length === 0) {
    return textResult({ success: false, error: 'No patterns found. Run scout_capture and scout_analyze first.' });
  }

  const baseTokens = generateTokens(patterns);
  const colorPattern = patterns.find(p => p.category === 'color' && p.subcategory === 'palette');
  const moodPattern = patterns.find(p => p.category === 'mood');
  const capturedMood = (moodPattern?.data as any)?.mood || 'minimal';

  // Generate 3 directions by shifting the base tokens
  const styles = [
    {
      name: 'Refined',
      description: 'Clean lines, generous whitespace, understated color. The captured palette used at low saturation with ample breathing room. Typography leads.',
      tokens: {
        ...baseTokens,
        colors: {
          ...baseTokens.colors,
          background: lighten(baseTokens.colors.background, 0.05),
          foreground: darken(baseTokens.colors.foreground, 0.1),
        },
        spacing: scaleSpacing(baseTokens.spacing, 1.2),
        borderRadius: { ...baseTokens.borderRadius, md: '0.375rem', lg: '0.75rem' },
      },
      css: formatTokens({ ...baseTokens, id: '' }, 'css'),
      mood: 'refined-' + capturedMood,
    },
    {
      name: 'Bold',
      description: 'High contrast, saturated primaries, tight spacing. The captured palette pushed to full intensity. Large type at heavy weights.',
      tokens: {
        ...baseTokens,
        colors: {
          ...baseTokens.colors,
          background: '#0a0a0a',
          foreground: '#f0f0f0',
        },
        spacing: scaleSpacing(baseTokens.spacing, 0.85),
        borderRadius: { ...baseTokens.borderRadius, md: '0.25rem', lg: '0.5rem' },
      },
      css: formatTokens({ ...baseTokens, id: '', colors: { ...baseTokens.colors, background: '#0a0a0a', foreground: '#f0f0f0' } }, 'css'),
      mood: 'bold-' + capturedMood,
    },
    {
      name: 'Expressive',
      description: 'Playful radius, mixed type weights, accent-driven layout. The captured palette with the accent color promoted to lead. Rounded surfaces.',
      tokens: {
        ...baseTokens,
        colors: {
          ...baseTokens.colors,
          primary: baseTokens.colors.accent || baseTokens.colors.primary,
          accent: baseTokens.colors.primary,
        },
        borderRadius: { ...baseTokens.borderRadius, md: '1rem', lg: '1.5rem', xl: '2rem' },
      },
      css: formatTokens({ ...baseTokens, id: '', colors: { ...baseTokens.colors, primary: baseTokens.colors.accent || baseTokens.colors.primary } }, 'css'),
      mood: 'expressive-' + capturedMood,
    },
  ];

  return textResult({
    success: true,
    brief: args.brief || 'Three design directions derived from captured inspiration.',
    styles: styles.map(s => ({
      name: s.name,
      description: s.description,
      mood: s.mood,
      colors: s.tokens.colors,
      borderRadius: s.tokens.borderRadius,
      css: s.css,
    })),
    message: 'Three design directions generated. Ask the user which style to proceed with, then use those tokens to build.',
  });
}

// Helpers for style variation
function lighten(hex: string, amount: number): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + Math.round(255 * amount));
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + Math.round(255 * amount));
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + Math.round(255 * amount));
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}
function darken(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - Math.round(255 * amount));
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - Math.round(255 * amount));
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - Math.round(255 * amount));
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}
function scaleSpacing(spacing: Record<string, string>, factor: number): Record<string, string> {
  const scaled: Record<string, string> = {};
  for (const [k, v] of Object.entries(spacing)) {
    const match = v.match(/^([\d.]+)(rem|px)?$/);
    if (match) {
      scaled[k] = `${(parseFloat(match[1]) * factor).toFixed(3)}${match[2] || 'rem'}`;
    } else {
      scaled[k] = v;
    }
  }
  return scaled;
}
