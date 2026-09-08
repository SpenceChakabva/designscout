#!/usr/bin/env node
import { Command } from 'commander';
import { getConfig } from './shared/config.js';
import {
  handleCapture,
  handleAnalyze,
  handleStorePatterns,
  handleSearch,
  handleTokens,
  handleStyles,
  handleCodegen,
  handleMoodBoard,
  handleCompare,
  handleAudit,
  handleDesignMd,
  handleCrawl,
  handleConsistency,
  handleInventory,
  handleA11y,
  handleList,
  handleDelete,
} from './mcp/tools.js';
import { closeDb } from './store/db.js';

const config = getConfig();
const program = new Command();

function print(result: { content: { type: string; text: string }[] }): void {
  console.log(result.content.map(b => b.text).join('\n'));
}
const int = (v: string) => parseInt(v, 10);

program
  .name('designscout')
  .description('Design research agent — capture, analyze, audit, and generate from website designs')
  .version('0.2.0');

program
  .command('capture <url>')
  .description('Visit a website, scroll through it, and capture screenshots')
  .option('-v, --viewport <spec>', 'Device keyword or WxH', 'desktop')
  .option('--viewports <list>', 'Comma-separated viewports for a responsive capture')
  .option('-r, --responsive', 'Capture mobile, tablet, and desktop')
  .option('--selector <css>', 'Capture only elements matching this selector')
  .option('-d, --delay <ms>', 'Scroll delay in ms', '400')
  .option('-m, --max-scrolls <n>', 'Max scroll captures', '30')
  .option('--no-dismiss-banners', 'Do not try to close cookie/consent overlays')
  .action(async (url, o) => {
    print(await handleCapture({
      url,
      viewport: o.responsive || o.viewports ? undefined : o.viewport,
      viewports: o.viewports,
      responsive: o.responsive,
      selector: o.selector,
      scroll_delay: int(o.delay),
      max_scrolls: int(o.maxScrolls),
      dismiss_banners: o.dismissBanners,
    }, config));
  });

program
  .command('list')
  .description('List captured sites or crawls')
  .option('-k, --kind <kind>', 'sites | crawls', 'sites')
  .option('-n, --limit <n>', 'Max rows', '25')
  .action(async (o) => print(await handleList({ kind: o.kind, limit: int(o.limit) }, config)));

program
  .command('delete <siteId>')
  .description('Delete a captured site and its data')
  .action(async (siteId) => print(await handleDelete({ site_id: siteId }, config)));

program
  .command('analyze')
  .description('Get screenshots for design analysis')
  .option('-s, --site-id <id>', 'Site ID from capture')
  .option('-u, --url <url>', 'URL of previously captured site')
  .action(async (o) => print(await handleAnalyze({ site_id: o.siteId, url: o.url }, config)));

program
  .command('store-patterns <siteId> <jsonFileOrString>')
  .description('Store a JSON array of DesignAnalysis objects (path to a file or a raw string)')
  .action(async (siteId, input) => {
    const fs = await import('node:fs');
    const analyses = fs.existsSync(input) ? fs.readFileSync(input, 'utf-8') : input;
    print(await handleStorePatterns({ site_id: siteId, analyses }, config));
  });

program
  .command('search <query>')
  .description('Search inspiration database for patterns')
  .option('-c, --category <cat>', 'Filter by category')
  .action(async (query, o) => print(await handleSearch({ query, category: o.category }, config)));

program
  .command('tokens')
  .description('Generate design tokens')
  .option('-s, --site-id <id>', 'Generate from a specific site')
  .option('-f, --format <fmt>', 'json | css | tailwind | style-dictionary | w3c | figma', 'json')
  .action(async (o) => print(await handleTokens({ site_id: o.siteId, format: o.format }, config)));

program
  .command('styles')
  .description('Generate 3 design directions (Refined, Bold, Expressive)')
  .option('-s, --site-id <id>')
  .option('-b, --brief <text>')
  .action(async (o) => print(await handleStyles({ site_id: o.siteId, brief: o.brief }, config)));

program
  .command('codegen <component>')
  .description('Scaffold a component: hero|navbar|card|footer|features|testimonials|cta|pricing')
  .option('-f, --framework <fw>', 'react | html', 'react')
  .option('-s, --site-id <id>')
  .option('-o, --output <path>', 'Write to this file')
  .option('-b, --brief <text>')
  .action(async (component, o) => print(await handleCodegen({
    component, framework: o.framework, site_id: o.siteId, output_path: o.output, brief: o.brief,
  }, config)));

program
  .command('moodboard')
  .description('Generate an HTML mood board')
  .option('-t, --title <title>')
  .option('-s, --site-ids <ids>', 'Comma-separated site IDs')
  .option('-b, --brief <text>')
  .action(async (o) => print(await handleMoodBoard({
    title: o.title, site_ids: o.siteIds?.split(',').map((s: string) => s.trim()), brief: o.brief,
  }, config)));

program
  .command('compare')
  .description('Compare designs across captured sites')
  .option('-s, --site-ids <ids>', 'Comma-separated site IDs')
  .option('-u, --urls <urls>', 'Comma-separated URLs')
  .action(async (o) => print(await handleCompare({
    site_ids: o.siteIds?.split(',').map((s: string) => s.trim()),
    urls: o.urls?.split(',').map((s: string) => s.trim()),
  }, config)));

program
  .command('audit')
  .description('Check a file, text, or captured site for AI design/copy tells')
  .option('-f, --file <path>')
  .option('-t, --text <text>')
  .option('-s, --site-id <id>')
  .option('-u, --url <url>')
  .option('-c, --check <filter>', 'Category or rule ID')
  .action(async (o) => print(await handleAudit({
    file_path: o.file, text: o.text, site_id: o.siteId, url: o.url, check: o.check,
  }, config)));

program
  .command('a11y')
  .description('Deterministic accessibility scan of a captured site or URL')
  .option('-s, --site-id <id>')
  .option('-u, --url <url>')
  .action(async (o) => print(await handleA11y({ site_id: o.siteId, url: o.url }, config)));

program
  .command('inventory')
  .description('Component inventory from the live DOM')
  .option('-s, --site-id <id>')
  .option('-u, --url <url>')
  .action(async (o) => print(await handleInventory({ site_id: o.siteId, url: o.url }, config)));

program
  .command('designmd')
  .description('Generate an impeccable-compatible DESIGN.md')
  .option('-s, --site-id <id>')
  .option('-n, --name <name>')
  .option('-o, --output <path>', 'Output path', 'DESIGN.md')
  .action(async (o) => print(await handleDesignMd({ site_id: o.siteId, name: o.name, output_path: o.output }, config)));

program
  .command('crawl <url>')
  .description('Crawl a site\'s internal pages and capture each')
  .option('-p, --max-pages <n>', 'Max pages', '20')
  .option('-d, --max-depth <n>', 'Link depth', '2')
  .option('--include <regex>')
  .option('--exclude <regex>')
  .action(async (url, o) => print(await handleCrawl({
    url, max_pages: int(o.maxPages), max_depth: int(o.maxDepth),
    include_pattern: o.include, exclude_pattern: o.exclude,
  }, config)));

program
  .command('consistency')
  .description('Cross-page consistency report from the latest (or a given) crawl')
  .option('-c, --crawl-id <id>')
  .action(async (o) => print(await handleConsistency({ crawl_id: o.crawlId }, config)));

program
  .command('serve')
  .description('Start the MCP server (stdio transport)')
  .action(async () => {
    const { startServer } = await import('./mcp/server.js');
    await startServer(config);
  });

program.hook('postAction', () => closeDb());

program.parseAsync().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
