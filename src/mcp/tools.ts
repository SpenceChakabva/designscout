import type { DesignScoutConfig, DesignAnalysis, TokenFormat, NamedViewport, ComponentType, Framework } from '../shared/types.js';
import { getDb } from '../store/db.js';
import * as queries from '../store/queries.js';
import { captureSite } from '../browser/capture.js';
import { crawlSite } from '../browser/crawl.js';
import { inspectPage } from '../browser/inspect.js';
import { extractInventory, extractAccessibility } from '../browser/extract.js';
import { ANALYSIS_SCHEMA, selectScreenshots, extractPatterns } from '../analyzer/vision.js';
import { generateTokens, formatTokens, defaultTokens } from '../outputs/tokens.js';
import { buildMoodBoardEntry, generateMoodBoard } from '../outputs/moodboard.js';
import { generateDesignMd } from '../outputs/designmd.js';
import { generateComponent } from '../outputs/codegen.js';
import { buildConsistencyReport, writeConsistencyHtml } from '../outputs/consistency.js';
import { buildAccessibilityReport, summarizeA11y } from '../audit/a11y.js';
import {
  runAudit, auditTokens, auditCopy, auditExtraction, auditMarkup, type Finding,
} from '../audit/rules.js';
import { resolveViewport, VIEWPORT_PRESETS } from '../shared/config.js';
import { v4 as uuid } from 'uuid';
import fs from 'node:fs';
import nodePath from 'node:path';

// All tools return plain text — no base64 images over stdio.
type ToolResult = { content: { type: 'text'; text: string }[] };

function textResult(data: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

const RESPONSIVE_SET: NamedViewport[] = [
  VIEWPORT_PRESETS.mobile,
  VIEWPORT_PRESETS.tablet,
  VIEWPORT_PRESETS.desktop,
];

// ════════════════════════════════════════════════════════════════════════════
// scout_capture
// ════════════════════════════════════════════════════════════════════════════

export async function handleCapture(
  args: {
    url: string;
    viewport?: string;
    viewports?: string;
    responsive?: boolean;
    selector?: string;
    scroll_delay?: number;
    max_scrolls?: number;
    dismiss_banners?: boolean;
  },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);

  let viewports: NamedViewport[] | undefined;
  if (args.responsive) {
    viewports = RESPONSIVE_SET;
  } else if (args.viewports) {
    viewports = args.viewports.split(',').map(s => resolveViewport(s.trim())).filter(Boolean);
  } else if (args.viewport) {
    viewports = [resolveViewport(args.viewport)];
  }

  const site = await captureSite(
    {
      url: args.url,
      viewports,
      selector: args.selector,
      scrollDelay: args.scroll_delay,
      maxScrolls: args.max_scrolls,
      dismissBanners: args.dismiss_banners,
    },
    config,
  );

  queries.insertSite(db, {
    id: site.id,
    url: site.url,
    title: site.title,
    capturedAt: site.capturedAt,
    viewport: site.viewport,
    metadata: site.metadata,
  });
  for (const screenshot of site.screenshots) queries.insertScreenshot(db, screenshot);

  const meta = site.metadata as any;
  const selected = selectScreenshots(site.screenshots, 6);
  const layoutIssues = (meta?.layoutIssues || []) as any[];

  return textResult({
    success: true,
    siteId: site.id,
    url: site.url,
    title: site.title,
    mode: meta?.mode,
    viewports: meta?.viewports || [],
    screenshotCount: site.screenshots.length,
    screenshots: selected.map(s => ({
      filepath: s.filepath,
      scrollPosition: s.scrollPosition,
      device: s.deviceType || null,
      viewport: s.viewportLabel || null,
      sectionLabel: s.sectionLabel || null,
    })),
    allScreenshotPaths: site.screenshots.map(s => s.filepath),
    layoutIssues: layoutIssues.map(i => ({
      viewport: i.viewportLabel, device: i.device, type: i.type, detail: i.detail, selector: i.selector,
    })),
    extraction: meta?.extraction || null,
    sections: meta?.sections || [],
    capture: meta?.capture || null,
    bannersDismissed: meta?.bannersDismissed ?? 0,
    message:
      `Captured ${site.screenshots.length} screenshots of "${site.title}" across ${(meta?.viewports?.length) || 1} viewport(s), ` +
      `${(meta?.capture?.coveragePercent) || '?'}% page coverage, ${layoutIssues.length} layout issue(s) flagged. ` +
      `Read the screenshots, then call scout_store_patterns with siteId "${site.id}". ` +
      `Run scout_audit with site_id "${site.id}" to check the source for AI tells.`,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// scout_analyze
// ════════════════════════════════════════════════════════════════════════════

export async function handleAnalyze(
  args: { site_id?: string; url?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  const site = queries.resolveSite(db, args);
  if (!site) return textResult({ success: false, error: 'Provide a valid site_id or url of a captured site. Run scout_capture first.' });

  const selected = selectScreenshots(site.screenshots, 6);
  return textResult({
    success: true,
    siteId: site.id,
    url: site.url,
    title: site.title,
    screenshotPaths: selected.map(s => s.filepath),
    analysisSchema: ANALYSIS_SCHEMA,
    message: `Read the screenshot files listed above to visually analyze "${site.title}". For each screenshot, extract design info matching the schema. Then call scout_store_patterns with siteId "${site.id}" and a JSON array of your analyses.`,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// scout_store_patterns
// ════════════════════════════════════════════════════════════════════════════

export async function handleStorePatterns(
  args: { site_id: string; analyses: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  if (!args.site_id) return textResult({ success: false, error: 'site_id is required.' });
  if (!queries.getSite(db, args.site_id)) return textResult({ success: false, error: `Site ${args.site_id} not found.` });

  let parsed: DesignAnalysis[];
  try {
    const cleaned = args.analyses.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) parsed = [parsed];
  } catch (err) {
    return textResult({ success: false, error: `Failed to parse analyses JSON: ${(err as Error).message}` });
  }
  if (parsed.length === 0) return textResult({ success: false, error: 'No analyses provided.' });

  const patterns = extractPatterns(parsed, args.site_id);
  for (const pattern of patterns) queries.insertPattern(db, pattern);

  return textResult({
    success: true,
    siteId: args.site_id,
    patternsStored: patterns.length,
    patterns: patterns.map(p => ({ category: p.category, subcategory: p.subcategory, description: p.description })),
    message: `Stored ${patterns.length} design patterns. Use scout_tokens, scout_styles, scout_designmd, or scout_moodboard next.`,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// scout_search
// ════════════════════════════════════════════════════════════════════════════

export async function handleSearch(
  args: { query: string; category?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  if (!args.query?.trim()) return textResult({ success: false, error: 'query is required.' });

  const patterns = queries.searchPatterns(db, args.query.trim(), args.category);
  if (patterns.length === 0) {
    return textResult({ success: true, results: [], message: `No patterns found matching "${args.query}".` });
  }

  const bySite: Record<string, { url: string; patterns: typeof patterns }> = {};
  for (const p of patterns) {
    const site = queries.getSite(db, p.siteId);
    if (!bySite[p.siteId]) bySite[p.siteId] = { url: site?.url || 'unknown', patterns: [] };
    bySite[p.siteId].patterns.push(p);
  }

  return textResult({
    success: true,
    totalResults: patterns.length,
    sites: Object.entries(bySite).map(([siteId, data]) => ({
      siteId,
      url: data.url,
      matchingPatterns: data.patterns.map(p => ({
        category: p.category, subcategory: p.subcategory, description: p.description, confidence: p.confidence, data: p.data,
      })),
    })),
  });
}

// ════════════════════════════════════════════════════════════════════════════
// scout_tokens
// ════════════════════════════════════════════════════════════════════════════

const TOKEN_FORMATS: TokenFormat[] = ['json', 'css', 'tailwind', 'style-dictionary', 'w3c', 'figma'];

export async function handleTokens(
  args: { site_id?: string; format?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  const format = (TOKEN_FORMATS.includes(args.format as TokenFormat) ? args.format : 'json') as TokenFormat;

  let patterns;
  if (args.site_id) {
    patterns = queries.getPatternsForSite(db, args.site_id);
  } else {
    patterns = queries.listSites(db, 5).flatMap(s => queries.getPatternsForSite(db, s.id));
  }
  if (patterns.length === 0) {
    return textResult({ success: false, error: 'No patterns found. Run scout_capture, scout_analyze, and scout_store_patterns first.' });
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

// ════════════════════════════════════════════════════════════════════════════
// scout_moodboard
// ════════════════════════════════════════════════════════════════════════════

export async function handleMoodBoard(
  args: { title?: string; site_ids?: string[]; brief?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  const title = args.title || 'Design Inspiration';

  const sites = args.site_ids?.length
    ? args.site_ids.map(id => queries.getSite(db, id)).filter(Boolean)
    : queries.listSites(db, 10);
  if (sites.length === 0) return textResult({ success: false, error: 'No sites found. Run scout_capture first.' });

  const entries = sites.map(site => {
    const patterns = queries.getPatternsForSite(db, site!.id);
    const tokens = queries.getTokensForSite(db, site!.id) || undefined;
    return buildMoodBoardEntry(site!.url, site!.title, site!.screenshots, patterns, tokens);
  });

  const outputPath = generateMoodBoard(entries, title, config, args.brief);
  return textResult({
    success: true, outputPath, siteCount: entries.length,
    message: `Generated mood board with ${entries.length} sites at: ${outputPath}`,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// scout_compare
// ════════════════════════════════════════════════════════════════════════════

export async function handleCompare(
  args: { site_ids?: string[]; urls?: string[] },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  const siteIds = [...(args.site_ids || [])];
  for (const url of args.urls || []) {
    const site = queries.findSiteByUrl(db, url);
    if (site) siteIds.push(site.id);
  }
  if (siteIds.length < 2) return textResult({ success: false, error: 'Need at least 2 captured sites to compare.' });

  const siteData = siteIds.map(id => {
    const site = queries.getSite(db, id);
    if (!site) return null;
    const patterns = queries.getPatternsForSite(db, id);
    const selected = selectScreenshots(site.screenshots, 3);
    return {
      siteId: id, url: site.url, title: site.title,
      screenshotPaths: selected.map(s => s.filepath),
      patterns: patterns.map(p => ({ category: p.category, subcategory: p.subcategory, description: p.description })),
    };
  }).filter(Boolean);

  return textResult({
    success: true, sitesCompared: siteData.length, sites: siteData,
    message: 'Read the screenshot files for each site to compare their designs. Pattern data is included for reference.',
  });
}

// ════════════════════════════════════════════════════════════════════════════
// scout_audit
// ════════════════════════════════════════════════════════════════════════════

export async function handleAudit(
  args: { file_path?: string; text?: string; site_id?: string; url?: string; check?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const allFindings: Finding[] = [];
  const targets: string[] = [];

  if (args.file_path) {
    targets.push(`file:${args.file_path}`);
    try {
      const content = fs.readFileSync(args.file_path, 'utf-8');
      const isMarkup = /\.(html?|jsx|tsx|vue|svelte|astro)$/i.test(args.file_path);
      if (isMarkup) {
        allFindings.push(...auditMarkup(content));
      } else {
        allFindings.push(...auditCopy(content));
        allFindings.push(...runAudit({ css: content }));
      }
    } catch (err) {
      return textResult({ success: false, error: `Failed to read file: ${(err as Error).message}` });
    }
  }

  if (args.text) {
    targets.push('text');
    allFindings.push(...auditCopy(args.text));
  }

  // Live-site audit: use the captured HTML + DOM extraction.
  const siteRef = args.site_id || args.url;
  if (siteRef) {
    const db = getDb(config);
    const site = queries.resolveSite(db, { site_id: args.site_id, url: args.url });
    if (!site) return textResult({ success: false, error: `No captured site for ${siteRef}. Run scout_capture first.` });
    targets.push(`site:${site.id}`);

    const meta = site.metadata as any;
    if (meta?.extraction) allFindings.push(...auditExtraction(meta.extraction));
    if (meta?.htmlPath && fs.existsSync(meta.htmlPath)) {
      allFindings.push(...auditMarkup(fs.readFileSync(meta.htmlPath, 'utf-8')));
    }
    const tokens = queries.getTokensForSite(db, site.id);
    if (tokens) allFindings.push(...auditTokens(tokens));
    else {
      const patterns = queries.getPatternsForSite(db, site.id);
      if (patterns.length) allFindings.push(...auditTokens(generateTokens(patterns)));
    }
  }

  if (targets.length === 0) {
    return textResult({ success: false, error: 'Provide file_path, text, site_id, or url to audit.' });
  }

  const filtered = args.check
    ? allFindings.filter(f => f.category === args.check || f.ruleId === args.check)
    : allFindings;

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

  if (args.site_id || args.url) {
    const db = getDb(config);
    const site = queries.resolveSite(db, { site_id: args.site_id, url: args.url });
    if (site) queries.insertAudit(db, site.id, targets.join(','), { summary, findings: deduped });
  }

  return textResult({
    success: true,
    targets,
    summary,
    findings: deduped.map(f => ({
      rule: f.ruleId, category: f.category, severity: f.severity,
      name: f.name, description: f.description, snippet: f.snippet, fix: f.fix,
    })),
    clean: deduped.length === 0,
    message: deduped.length === 0
      ? 'Clean. No anti-patterns or AI tells detected.'
      : `Found ${deduped.length} issue(s): ${summary.byCategory.slop} design slop, ${summary.byCategory.copy} copy tells, ${summary.byCategory.quality} quality issues.`,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// scout_designmd
// ════════════════════════════════════════════════════════════════════════════

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
    return textResult({ success: false, error: 'No patterns found. Run scout_capture, scout_analyze, and scout_store_patterns first.' });
  }

  const tokens = generateTokens(patterns);
  tokens.id = uuid();
  const markdown = generateDesignMd(siteName, patterns, tokens);

  const outputPath = args.output_path || 'DESIGN.md';
  try {
    fs.writeFileSync(outputPath, markdown, 'utf-8');
  } catch {
    return textResult({ success: true, content: markdown, message: `Generated DESIGN.md (could not write to ${outputPath}, content returned inline).` });
  }
  return textResult({
    success: true, outputPath, patternCount: patterns.length,
    message: `Generated DESIGN.md at ${outputPath} from ${patterns.length} patterns. Compatible with impeccable.`,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// scout_styles
// ════════════════════════════════════════════════════════════════════════════

export async function handleStyles(
  args: { site_id?: string; brief?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  const patterns = args.site_id
    ? queries.getPatternsForSite(db, args.site_id)
    : queries.listSites(db, 5).flatMap(s => queries.getPatternsForSite(db, s.id));
  if (patterns.length === 0) {
    return textResult({ success: false, error: 'No patterns found. Run scout_capture, scout_analyze, and scout_store_patterns first.' });
  }

  const baseTokens = generateTokens(patterns);
  const moodPattern = patterns.find(p => p.category === 'mood');
  const capturedMood = (moodPattern?.data as any)?.mood || 'minimal';

  const styles = [
    {
      name: 'Refined',
      description: 'Clean lines, generous whitespace, understated color. The captured palette at low saturation with room to breathe. Typography leads.',
      colors: {
        ...baseTokens.colors,
        background: lighten(baseTokens.colors.background, 0.05),
        foreground: darken(baseTokens.colors.foreground, 0.1),
      },
      borderRadius: { ...baseTokens.borderRadius, md: '0.375rem', lg: '0.75rem' },
      spacing: scaleSpacing(baseTokens.spacing, 1.2),
      mood: 'refined-' + capturedMood,
    },
    {
      name: 'Bold',
      description: 'High contrast, saturated primaries, tight spacing. The captured palette at full intensity. Large type at heavy weights.',
      colors: { ...baseTokens.colors, background: '#0a0a0a', foreground: '#f0f0f0' },
      borderRadius: { ...baseTokens.borderRadius, md: '0.25rem', lg: '0.5rem' },
      spacing: scaleSpacing(baseTokens.spacing, 0.85),
      mood: 'bold-' + capturedMood,
    },
    {
      name: 'Expressive',
      description: 'Playful radius, mixed type weights, accent-driven layout. The captured accent color promoted to lead. Rounded surfaces.',
      colors: {
        ...baseTokens.colors,
        primary: baseTokens.colors.accent || baseTokens.colors.primary,
        accent: baseTokens.colors.primary,
      },
      borderRadius: { ...baseTokens.borderRadius, md: '1rem', lg: '1.5rem', xl: '2rem' },
      spacing: baseTokens.spacing,
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
      colors: s.colors,
      borderRadius: s.borderRadius,
      css: formatTokens({ ...baseTokens, id: '', colors: s.colors, borderRadius: s.borderRadius, spacing: s.spacing }, 'css'),
    })),
    message: 'Three design directions generated. Ask the user which style to proceed with, then use those tokens to build. scout_codegen can scaffold components from the chosen set.',
  });
}

// ════════════════════════════════════════════════════════════════════════════
// scout_crawl
// ════════════════════════════════════════════════════════════════════════════

export async function handleCrawl(
  args: {
    url: string;
    max_pages?: number;
    max_depth?: number;
    same_origin_only?: boolean;
    include_pattern?: string;
    exclude_pattern?: string;
  },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  const crawl = await crawlSite({
    startUrl: args.url,
    maxPages: args.max_pages,
    maxDepth: args.max_depth,
    sameOriginOnly: args.same_origin_only,
    includePattern: args.include_pattern,
    excludePattern: args.exclude_pattern,
  }, config);

  queries.insertCrawl(db, crawl);

  const unique = crawl.pages.filter(p => !p.duplicateOf);
  return textResult({
    success: true,
    crawlId: crawl.id,
    startUrl: crawl.startUrl,
    pagesVisited: crawl.pages.length,
    uniquePages: unique.length,
    duplicates: crawl.pages.length - unique.length,
    skipped: crawl.skipped,
    pages: crawl.pages.map(p => ({
      path: p.path, depth: p.depth, title: p.title,
      duplicateOf: p.duplicateOf ? new URL(p.duplicateOf).pathname : undefined,
      screenshot: p.screenshot,
    })),
    message: `Crawled ${crawl.pages.length} pages (${unique.length} unique). Run scout_consistency with crawlId "${crawl.id}" for a cross-page design report.`,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// scout_consistency
// ════════════════════════════════════════════════════════════════════════════

export async function handleConsistency(
  args: { crawl_id?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  const crawl = args.crawl_id ? queries.getCrawl(db, args.crawl_id) : queries.getLatestCrawl(db);
  if (!crawl) return textResult({ success: false, error: 'No crawl found. Run scout_crawl first.' });

  const report = buildConsistencyReport(crawl);
  const htmlPath = writeConsistencyHtml(report, crawl, config);

  return textResult({
    success: true,
    crawlId: crawl.id,
    score: report.score,
    pageCount: report.pageCount,
    findings: report.findings,
    reportPath: htmlPath,
    message: `Consistency score ${report.score}/100 across ${report.pageCount} pages. ${report.findings.length} finding(s). Full report: ${htmlPath}`,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// scout_inventory
// ════════════════════════════════════════════════════════════════════════════

export async function handleInventory(
  args: { site_id?: string; url?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  const site = queries.resolveSite(db, args);
  const targetUrl = site?.url || args.url;
  if (!targetUrl) return textResult({ success: false, error: 'Provide site_id or url.' });

  const items = await inspectPage(targetUrl, config, page => page.evaluate(extractInventory));

  return textResult({
    success: true,
    url: targetUrl,
    componentCount: items.length,
    inventory: items,
    message:
      `Found ${items.length} distinct component variants. ` +
      `Buttons: ${items.filter(i => i.type === 'button').length}, cards: ${items.filter(i => i.type === 'card').length}, ` +
      `inputs: ${items.filter(i => i.type === 'input').length}. Use this to match component styling when building.`,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// scout_a11y
// ════════════════════════════════════════════════════════════════════════════

export async function handleA11y(
  args: { site_id?: string; url?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  const site = queries.resolveSite(db, args);
  const targetUrl = site?.url || args.url;
  if (!targetUrl) return textResult({ success: false, error: 'Provide site_id or url.' });

  const raw = await inspectPage(targetUrl, config, page => page.evaluate(extractAccessibility));
  const report = buildAccessibilityReport(site?.id || targetUrl, raw);
  if (site) queries.insertAudit(db, site.id, 'a11y', report);

  return textResult({
    success: true,
    url: targetUrl,
    score: report.score,
    issues: report.issues,
    headingOutline: report.headingOutline,
    landmarks: report.landmarks,
    message: summarizeA11y(report),
  });
}

// ════════════════════════════════════════════════════════════════════════════
// scout_codegen
// ════════════════════════════════════════════════════════════════════════════

const COMPONENT_TYPES: ComponentType[] = ['hero', 'navbar', 'card', 'footer', 'features', 'testimonials', 'cta', 'pricing'];

export async function handleCodegen(
  args: { component: string; framework?: string; site_id?: string; brief?: string; output_path?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  const component = (COMPONENT_TYPES.includes(args.component as ComponentType) ? args.component : null) as ComponentType | null;
  if (!component) {
    return textResult({ success: false, error: `component must be one of: ${COMPONENT_TYPES.join(', ')}` });
  }
  const framework = (args.framework === 'html' ? 'html' : 'react') as Framework;

  const patterns = args.site_id
    ? queries.getPatternsForSite(db, args.site_id)
    : queries.listSites(db, 5).flatMap(s => queries.getPatternsForSite(db, s.id));

  let tokens = args.site_id ? queries.getTokensForSite(db, args.site_id) : queries.getLatestTokens(db);
  let usedDefault = false;
  if (!tokens) {
    if (patterns.length > 0) {
      tokens = generateTokens(patterns);
      tokens.id = uuid();
    } else {
      tokens = defaultTokens();
      usedDefault = true;
    }
  }

  const result = generateComponent(component, framework, tokens, patterns, args.brief);

  // Actually self-audit the output — the README promises codegen is "pre-checked
  // against the AI-tell rules", so run them and report, not just hand-avoid.
  const selfAudit = auditMarkup(result.code);
  const auditClean = selfAudit.length === 0;

  let written: string | undefined;
  if (args.output_path) {
    try { fs.writeFileSync(args.output_path, result.code, 'utf-8'); written = args.output_path; } catch { /* return inline */ }
  }

  return textResult({
    success: true,
    component,
    framework,
    filename: result.filename,
    outputPath: written,
    code: result.code,
    usedDefaultTokens: usedDefault,
    auditClean,
    auditFindings: selfAudit.map(f => ({
      rule: f.ruleId, category: f.category, severity: f.severity, name: f.name, description: f.description, fix: f.fix,
    })),
    message:
      `Generated ${component} (${framework})${usedDefault ? ' using DesignScout\'s default token set (no captured site found)' : ''}. ` +
      `${written ? `Written to ${written}. ` : 'Returned inline. '}` +
      `Self-audit: ${auditClean ? 'clean, 0 tells.' : `${selfAudit.length} finding(s) — review auditFindings.`}`,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// scout_list / scout_delete
// ════════════════════════════════════════════════════════════════════════════

export async function handleList(
  args: { kind?: string; limit?: number },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  const limit = Math.min(Math.max(args.limit || 25, 1), 100);
  const kind = args.kind || 'sites';

  if (kind === 'crawls') {
    return textResult({ success: true, kind, crawls: queries.listCrawls(db, limit) });
  }

  const sites = queries.listSites(db, limit).map(s => ({
    siteId: s.id,
    url: s.url,
    title: s.title,
    capturedAt: s.capturedAt,
    viewport: s.viewport,
    screenshotCount: s.screenshots.length,
    patternCount: queries.getPatternsForSite(db, s.id).length,
  }));
  return textResult({ success: true, kind: 'sites', count: sites.length, sites });
}

export async function handleDelete(
  args: { site_id: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  if (!args.site_id) return textResult({ success: false, error: 'site_id is required.' });

  const site = queries.getSite(db, args.site_id);
  if (!site) return textResult({ success: false, error: `Site ${args.site_id} not found.` });

  // Best-effort screenshot dir cleanup
  const dir = site.screenshots[0]?.filepath ? nodePath.dirname(site.screenshots[0].filepath) : null;
  const deleted = queries.deleteSite(db, args.site_id);
  if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } }

  return textResult({
    success: deleted,
    siteId: args.site_id,
    message: deleted ? `Deleted site ${args.site_id} and its patterns, tokens, and screenshots.` : 'Nothing deleted.',
  });
}

// ── style-variation helpers ──

function lighten(hex: string, amount: number): string {
  return shiftHex(hex, Math.round(255 * amount));
}
function darken(hex: string, amount: number): string {
  return shiftHex(hex, -Math.round(255 * amount));
}
function shiftHex(hex: string, delta: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp(parseInt(hex.slice(1, 3), 16) + delta);
  const g = clamp(parseInt(hex.slice(3, 5), 16) + delta);
  const b = clamp(parseInt(hex.slice(5, 7), 16) + delta);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
function scaleSpacing(spacing: Record<string, string>, factor: number): Record<string, string> {
  const scaled: Record<string, string> = {};
  for (const [k, v] of Object.entries(spacing)) {
    const m = v.match(/^([\d.]+)(rem|px)?$/);
    scaled[k] = m ? `${(parseFloat(m[1]) * factor).toFixed(3)}${m[2] || 'rem'}` : v;
  }
  return scaled;
}
