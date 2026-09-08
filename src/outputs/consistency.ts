import fs from 'node:fs';
import path from 'node:path';
import type {
  CrawlResult,
  CrawlPage,
  ConsistencyReport,
  ConsistencyFinding,
  DesignScoutConfig,
} from '../shared/types.js';

/**
 * Diff the design signals gathered across a crawl and report where the pages
 * drift apart — different fonts, an exploding colour count, inconsistent
 * container widths, a nav/footer that changes between pages.
 */
export function buildConsistencyReport(crawl: CrawlResult): ConsistencyReport {
  const pages = crawl.pages.filter(p => p.signals && !p.duplicateOf);
  const findings: ConsistencyFinding[] = [];

  if (pages.length < 2) {
    return {
      crawlId: crawl.id,
      pageCount: pages.length,
      score: 100,
      findings: [{
        category: 'layout',
        severity: 'advisory',
        detail: 'Only one unique page captured — nothing to compare.',
        pages: pages.map(p => p.path),
      }],
      tokensByPage: {},
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Typography ──
  const headingFonts = groupBy(pages, p => firstFamily(p.signals!.headingFont));
  if (headingFonts.size > 1) {
    findings.push({
      category: 'typography',
      severity: 'error',
      detail: `Heading font differs across pages: ${[...headingFonts.keys()].join(' vs ')}.`,
      pages: pages.map(p => p.path),
    });
  }
  const bodyFonts = groupBy(pages, p => firstFamily(p.signals!.bodyFont));
  if (bodyFonts.size > 1) {
    findings.push({
      category: 'typography',
      severity: 'warning',
      detail: `Body font differs across pages: ${[...bodyFonts.keys()].join(' vs ')}.`,
      pages: pages.map(p => p.path),
    });
  }

  // ── Colour spread ──
  const allColors = new Set<string>();
  for (const p of pages) p.signals!.colors.forEach(c => allColors.add(c));
  const perPageAvg = avg(pages.map(p => p.signals!.colors.length));
  if (allColors.size > Math.max(24, perPageAvg * 2.5)) {
    findings.push({
      category: 'color',
      severity: 'warning',
      detail: `${allColors.size} distinct text colours across the site (avg ${Math.round(perPageAvg)}/page). The palette is not being reused.`,
      pages: pages.map(p => p.path),
    });
  }
  const bgSets = pages.map(p => new Set(p.signals!.backgrounds));
  const commonBg = [...bgSets[0]].filter(b => bgSets.every(s => s.has(b)));
  if (commonBg.length === 0) {
    findings.push({
      category: 'color',
      severity: 'advisory',
      detail: 'No background colour is shared by every page — surfaces are defined per-page.',
      pages: pages.map(p => p.path),
    });
  }

  // ── Radius scale ──
  const radii = new Set<string>();
  for (const p of pages) p.signals!.borderRadii.forEach(r => radii.add(r));
  if (radii.size > 6) {
    findings.push({
      category: 'component',
      severity: 'advisory',
      detail: `${radii.size} distinct border-radius values in use. A shared radius scale keeps components feeling related.`,
      pages: pages.map(p => p.path),
    });
  }

  // ── Container width ──
  const widths = groupBy(pages, p => p.signals!.maxWidths.sort().join(','));
  if (widths.size > 1 && pages.length > 2) {
    findings.push({
      category: 'layout',
      severity: 'warning',
      detail: 'Container max-width sets differ between pages — content columns will not line up.',
      pages: pages.map(p => p.path),
    });
  }

  // ── Nav / footer stability ──
  const navs = groupBy(pages.filter(p => p.signals!.navSignature), p => p.signals!.navSignature);
  if (navs.size > 1) {
    findings.push({
      category: 'component',
      severity: 'warning',
      detail: 'The primary navigation content changes between pages.',
      pages: pages.map(p => p.path),
    });
  }
  const footers = groupBy(pages.filter(p => p.signals!.footerSignature), p => p.signals!.footerSignature);
  if (footers.size > 1) {
    findings.push({
      category: 'component',
      severity: 'advisory',
      detail: 'The footer content changes between pages.',
      pages: pages.map(p => p.path),
    });
  }

  // ── Multiple H1 ──
  const multiH1 = pages.filter(p => p.signals!.h1Count !== 1);
  if (multiH1.length) {
    findings.push({
      category: 'typography',
      severity: 'advisory',
      detail: `${multiH1.length} page(s) do not have exactly one <h1>.`,
      pages: multiH1.map(p => p.path),
    });
  }

  const penalty = findings.reduce((sum, f) =>
    sum + (f.severity === 'error' ? 20 : f.severity === 'warning' ? 8 : 3), 0);
  const score = Math.max(0, 100 - penalty);

  const tokensByPage: ConsistencyReport['tokensByPage'] = {};
  for (const p of pages) {
    tokensByPage[p.path] = {
      colors: Object.fromEntries(p.signals!.colors.slice(0, 8).map((c, i) => [`c${i}`, c])),
      typography: {
        fontFamilies: { heading: p.signals!.headingFont, body: p.signals!.bodyFont },
        fontSizes: {}, fontWeights: {}, lineHeights: {},
      },
    };
  }

  return {
    crawlId: crawl.id,
    pageCount: pages.length,
    score,
    findings: findings.sort((a, b) =>
      sev(b.severity) - sev(a.severity)),
    tokensByPage,
    generatedAt: new Date().toISOString(),
  };
}

export function writeConsistencyHtml(
  report: ConsistencyReport,
  crawl: CrawlResult,
  config: DesignScoutConfig,
): string {
  const rows = report.findings.map(f => `
    <tr class="sev-${f.severity}">
      <td>${f.severity}</td>
      <td>${f.category}</td>
      <td>${escapeHtml(f.detail)}</td>
      <td>${f.pages.slice(0, 6).map(escapeHtml).join('<br>')}</td>
    </tr>`).join('');

  const pageList = crawl.pages.map(p => `
    <li>
      <code>${escapeHtml(p.path)}</code>
      ${p.duplicateOf ? `<span class="dup">duplicate of ${escapeHtml(new URL(p.duplicateOf).pathname)}</span>` : ''}
    </li>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Consistency report — ${escapeHtml(crawl.startUrl)}</title>
<style>
  body { font-family: 'DM Sans', system-ui, sans-serif; background: #10100f; color: #e8e6e1; margin: 0; padding: 2.5rem; line-height: 1.6; }
  h1 { font-size: 1.75rem; margin: 0 0 .25rem; letter-spacing: -0.02em; }
  .meta { color: #8a8783; font-size: .875rem; margin-bottom: 2rem; }
  .score { display: inline-block; font-size: 3rem; font-weight: 700; padding: .5rem 1.25rem; border: 2px solid currentColor; border-radius: 4px; }
  .score.good { color: #7bbf6a; } .score.mid { color: #d6b24a; } .score.bad { color: #d1685e; }
  table { width: 100%; border-collapse: collapse; margin: 2rem 0; font-size: .9rem; }
  th, td { text-align: left; padding: .6rem .75rem; border-bottom: 1px solid #26251f; vertical-align: top; }
  th { color: #8a8783; text-transform: uppercase; font-size: .7rem; letter-spacing: .08em; }
  tr.sev-error td:first-child { color: #d1685e; font-weight: 700; }
  tr.sev-warning td:first-child { color: #d6b24a; font-weight: 700; }
  tr.sev-advisory td:first-child { color: #8a8783; }
  ul { columns: 2; font-size: .85rem; } li { margin-bottom: .35rem; }
  .dup { color: #6a6862; font-style: italic; margin-left: .5rem; }
  code { background: #1c1b17; padding: .1rem .35rem; border-radius: 3px; }
</style></head><body>
  <h1>Design consistency report</h1>
  <p class="meta">${escapeHtml(crawl.startUrl)} · ${report.pageCount} unique pages · ${crawl.pages.length - report.pageCount} duplicates · ${report.generatedAt}</p>
  <div class="score ${report.score >= 80 ? 'good' : report.score >= 55 ? 'mid' : 'bad'}">${report.score}<span style="font-size:1rem">/100</span></div>
  <table>
    <thead><tr><th>Severity</th><th>Area</th><th>Finding</th><th>Pages</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">No inconsistencies detected.</td></tr>'}</tbody>
  </table>
  <h2 style="font-size:1rem">Pages crawled</h2>
  <ul>${pageList}</ul>
</body></html>`;

  const outPath = path.join(config.outputsDir, `consistency-${crawl.id}.html`);
  fs.writeFileSync(outPath, html, 'utf-8');
  return outPath;
}

// ── helpers ──

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    (map.get(k) ?? map.set(k, []).get(k)!).push(item);
  }
  return map;
}
function firstFamily(stack: string): string {
  return (stack || '').split(',')[0].replace(/["']/g, '').trim().toLowerCase();
}
function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}
function sev(s: ConsistencyFinding['severity']): number {
  return s === 'error' ? 3 : s === 'warning' ? 2 : 1;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
}
export type { CrawlPage };
