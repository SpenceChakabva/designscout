#!/usr/bin/env node
import { Command } from 'commander';
import { getConfig } from './shared/config.js';
import {
  handleCapture,
  handleAnalyze,
  handleStorePatterns,
  handleSearch,
  handleTokens,
  handleMoodBoard,
  handleCompare,
} from './mcp/tools.js';
import { closeDb, getDb } from './store/db.js';
import * as queries from './store/queries.js';

const config = getConfig();
const program = new Command();

// Extract text from tool result
function print(result: { content: { type: string; text: string }[] }): void {
  const text = result.content.map(b => b.text).join('\n');
  console.log(text);
}

program
  .name('designscout')
  .description('Design research agent — capture, analyze, and generate from website designs')
  .version('0.1.0');

program
  .command('capture <url>')
  .description('Visit a website, scroll through it, and capture screenshots')
  .option('-v, --viewport <WxH>', 'Viewport size', '1440x900')
  .option('-d, --delay <ms>', 'Scroll delay in ms', '400')
  .option('-m, --max-scrolls <n>', 'Max scroll captures', '30')
  .action(async (url: string, opts: { viewport: string; delay: string; maxScrolls: string }) => {
    print(await handleCapture(
      { url, viewport: opts.viewport, scroll_delay: parseInt(opts.delay), max_scrolls: parseInt(opts.maxScrolls) },
      config,
    ));
  });

program
  .command('list')
  .description('List all captured sites in the database')
  .option('-n, --limit <n>', 'Max sites to show', '20')
  .action(async (opts: { limit: string }) => {
    const db = getDb(config);
    const sites = queries.listSites(db, parseInt(opts.limit));
    if (sites.length === 0) {
      console.log('No sites captured yet. Run: designscout capture <url>');
      return;
    }
    console.log(`\n  ${'URL'.padEnd(45)} ${'Title'.padEnd(30)} Screenshots  Captured`);
    console.log('  ' + '─'.repeat(110));
    for (const s of sites) {
      console.log(`  ${s.url.padEnd(45).slice(0, 45)} ${(s.title || '—').padEnd(30).slice(0, 30)} ${String(s.screenshots.length).padStart(5)}        ${s.capturedAt.slice(0, 16)}`);
    }
    console.log(`\n  ${sites.length} site(s)\n`);
  });

program
  .command('analyze')
  .description('Get screenshots for design analysis')
  .option('-s, --site-id <id>', 'Site ID from capture')
  .option('-u, --url <url>', 'URL of previously captured site')
  .action(async (opts: { siteId?: string; url?: string }) => {
    print(await handleAnalyze({ site_id: opts.siteId, url: opts.url }, config));
  });

program
  .command('search <query>')
  .description('Search inspiration database for patterns')
  .option('-c, --category <cat>', 'Filter by category')
  .action(async (query: string, opts: { category?: string }) => {
    print(await handleSearch({ query, category: opts.category }, config));
  });

program
  .command('tokens')
  .description('Generate design tokens from analyzed patterns')
  .option('-s, --site-id <id>', 'Generate from a specific site')
  .option('-f, --format <fmt>', 'Output format: json, css, tailwind', 'json')
  .action(async (opts: { siteId?: string; format?: string }) => {
    print(await handleTokens({ site_id: opts.siteId, format: opts.format }, config));
  });

program
  .command('moodboard')
  .description('Generate an HTML mood board')
  .option('-t, --title <title>', 'Mood board title')
  .option('-s, --site-ids <ids>', 'Comma-separated site IDs')
  .option('-b, --brief <text>', 'Design brief')
  .action(async (opts: { title?: string; siteIds?: string; brief?: string }) => {
    const siteIds = opts.siteIds?.split(',').map(s => s.trim());
    print(await handleMoodBoard({ title: opts.title, site_ids: siteIds, brief: opts.brief }, config));
  });

program
  .command('compare')
  .description('Compare designs across captured sites')
  .option('-s, --site-ids <ids>', 'Comma-separated site IDs')
  .option('-u, --urls <urls>', 'Comma-separated URLs')
  .action(async (opts: { siteIds?: string; urls?: string }) => {
    const siteIds = opts.siteIds?.split(',').map(s => s.trim());
    const urls = opts.urls?.split(',').map(s => s.trim());
    print(await handleCompare({ site_ids: siteIds, urls }, config));
  });

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
