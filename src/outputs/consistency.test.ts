import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConsistencyReport } from './consistency.js';
import type { CrawlResult, CrawlPage, PageDesignSignals } from '../shared/types.js';

function signals(over: Partial<PageDesignSignals> = {}): PageDesignSignals {
  return {
    colors: ['rgb(20,19,16)', 'rgb(244,241,234)'],
    backgrounds: ['rgb(12,26,22)'],
    fontFamilies: ['Literata', 'DM Sans'],
    fontSizes: ['16px', '20px'],
    borderRadii: ['4px', '8px'],
    maxWidths: ['1200px'],
    headingFont: 'Literata, serif',
    bodyFont: 'DM Sans, sans-serif',
    h1Count: 1,
    navSignature: 'Home Product Docs',
    footerSignature: 'Privacy Terms',
    ...over,
  };
}

function page(path: string, s: PageDesignSignals): CrawlPage {
  return { siteId: '', url: `https://x.test${path}`, path, depth: 1, title: path, fingerprint: path, signals: s };
}

function crawl(pages: CrawlPage[]): CrawlResult {
  return { id: 'c1', startUrl: 'https://x.test', pages, skipped: [], generatedAt: new Date().toISOString() };
}

test('a consistent site scores high', () => {
  const report = buildConsistencyReport(crawl([
    page('/', signals()), page('/about', signals()), page('/pricing', signals()),
  ]));
  assert.ok(report.score >= 90, `expected high score, got ${report.score}`);
});

test('font drift is an error-level finding', () => {
  const report = buildConsistencyReport(crawl([
    page('/', signals()),
    page('/blog', signals({ headingFont: 'Poppins, sans-serif' })),
  ]));
  assert.ok(report.findings.some(f => f.category === 'typography' && f.severity === 'error'));
  assert.ok(report.score < 90);
});

test('unstable nav is flagged', () => {
  const report = buildConsistencyReport(crawl([
    page('/', signals()),
    page('/x', signals({ navSignature: 'totally different nav' })),
  ]));
  assert.ok(report.findings.some(f => f.detail.includes('navigation')));
});

test('single unique page returns a neutral report', () => {
  const report = buildConsistencyReport(crawl([page('/', signals())]));
  assert.equal(report.score, 100);
  assert.equal(report.pageCount, 1);
});
