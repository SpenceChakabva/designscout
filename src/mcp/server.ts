import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { DesignScoutConfig } from '../shared/types.js';
import {
  handleCapture,
  handleAnalyze,
  handleStorePatterns,
  handleSearch,
  handleTokens,
  handleMoodBoard,
  handleCompare,
  handleAudit,
  handleDesignMd,
  handleStyles,
  handleCrawl,
  handleConsistency,
  handleInventory,
  handleA11y,
  handleCodegen,
  handleList,
  handleDelete,
} from './tools.js';

export function createServer(config: DesignScoutConfig): McpServer {
  const server = new McpServer({ name: 'designscout', version: '0.2.0' });

  const wrap = (handler: (args: any, config: DesignScoutConfig) => Promise<any>) =>
    async (args: any) => {
      try {
        return await handler(args, config);
      } catch (err) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: (err as Error).message }) }] };
      }
    };

  server.tool(
    'scout_capture',
    'Visit a website, auto-scroll, and capture viewport screenshots. Supports responsive capture (mobile/tablet/desktop in one call) and selector-scoped capture. Flags responsive layout breakage. Returns screenshot file paths plus DOM-extracted styles.',
    {
      url: z.string().url().describe('The website URL to capture'),
      viewport: z.string().optional().describe('A device keyword (mobile|tablet|desktop) or "WIDTHxHEIGHT". Default desktop (1440x900).'),
      viewports: z.string().optional().describe('Comma-separated list of device keywords / "WxH" specs for a multi-viewport capture'),
      responsive: z.boolean().optional().describe('Shortcut for viewports=mobile,tablet,desktop'),
      selector: z.string().optional().describe('Capture only element(s) matching this CSS selector instead of the full page'),
      scroll_delay: z.number().optional().describe('Milliseconds between scroll steps, default 400'),
      max_scrolls: z.number().optional().describe('Scroll budget hint for lazy content, default 30'),
      dismiss_banners: z.boolean().optional().describe('Try to dismiss cookie/consent overlays before capturing (default true)'),
    },
    wrap(handleCapture),
  );

  server.tool(
    'scout_analyze',
    'Get screenshot file paths for a captured site plus the analysis schema. Read the screenshots, analyze them visually, then call scout_store_patterns.',
    {
      site_id: z.string().optional().describe('siteId from scout_capture'),
      url: z.string().optional().describe('URL of a previously captured site'),
    },
    wrap(handleAnalyze),
  );

  server.tool(
    'scout_store_patterns',
    'Store your visual design analysis. Pass a JSON array of DesignAnalysis objects matching the schema from scout_analyze.',
    {
      site_id: z.string().describe('siteId these analyses belong to'),
      analyses: z.string().describe('JSON array of DesignAnalysis objects'),
    },
    wrap(handleStorePatterns),
  );

  server.tool(
    'scout_search',
    'Search the inspiration database for design patterns by keyword and optional category.',
    {
      query: z.string().describe('What to search for (e.g. "dark hero", "pill buttons")'),
      category: z.enum(['color', 'typography', 'layout', 'component', 'spacing', 'mood']).optional(),
    },
    wrap(handleSearch),
  );

  server.tool(
    'scout_tokens',
    'Generate design tokens from stored patterns. Formats: json, css, tailwind, style-dictionary, w3c (DTCG), figma (Tokens Studio).',
    {
      site_id: z.string().optional().describe('Specific site, or omit to merge all'),
      format: z.enum(['json', 'css', 'tailwind', 'style-dictionary', 'w3c', 'figma']).optional(),
    },
    wrap(handleTokens),
  );

  server.tool(
    'scout_styles',
    'Generate 3 distinct design directions (Refined, Bold, Expressive) from captured patterns, each with its own token set. Present all three, let the user pick, then build.',
    {
      site_id: z.string().optional(),
      brief: z.string().optional().describe('Project context to guide the directions'),
    },
    wrap(handleStyles),
  );

  server.tool(
    'scout_codegen',
    'Scaffold a component (hero, navbar, card, footer, features, testimonials, cta, pricing) as React or HTML from a stored token set. Output is pre-checked against the AI-tell rules.',
    {
      component: z.enum(['hero', 'navbar', 'card', 'footer', 'features', 'testimonials', 'cta', 'pricing']),
      framework: z.enum(['react', 'html']).optional().describe('Default react'),
      site_id: z.string().optional().describe('Use this site\'s tokens; omit for the latest generated set'),
      brief: z.string().optional(),
      output_path: z.string().optional().describe('Write the file here instead of returning inline'),
    },
    wrap(handleCodegen),
  );

  server.tool(
    'scout_moodboard',
    'Generate an HTML mood board from captured sites.',
    {
      title: z.string().optional(),
      site_ids: z.array(z.string()).optional(),
      brief: z.string().optional(),
    },
    wrap(handleMoodBoard),
  );

  server.tool(
    'scout_compare',
    'Compare designs across multiple captured sites. Returns screenshot paths and patterns for each.',
    {
      site_ids: z.array(z.string()).optional().describe('At least 2 site IDs'),
      urls: z.array(z.string()).optional().describe('URLs of captured sites'),
    },
    wrap(handleCompare),
  );

  server.tool(
    'scout_audit',
    'Run anti-pattern detection on a file, raw text, or a captured site (site_id/url). Catches AI design tells (overused fonts, purple/cream palettes, gradient text, glassmorphism, icon-tile headings, 100vh sections, uniform radius) and copy tells (em-dash density, filler phrases, template testimonials). Deterministic rules, no LLM.',
    {
      file_path: z.string().optional().describe('Path to an HTML/CSS/JSX file to audit'),
      text: z.string().optional().describe('Raw text/copy to check'),
      site_id: z.string().optional().describe('Audit a captured site\'s real HTML + extracted styles + tokens'),
      url: z.string().optional().describe('URL of a captured site to audit'),
      check: z.string().optional().describe('Filter to a category (slop, copy, quality) or a rule ID'),
    },
    wrap(handleAudit),
  );

  server.tool(
    'scout_a11y',
    'Deterministic accessibility scan of a captured site or URL: alt text, control names, form labels, heading order, landmarks, focus-outline removal, positive tabindex. Returns a 0-100 score and the heading outline.',
    {
      site_id: z.string().optional(),
      url: z.string().optional(),
    },
    wrap(handleA11y),
  );

  server.tool(
    'scout_inventory',
    'Build a component inventory from the live DOM of a captured site or URL: buttons, inputs, cards, badges, nav — grouped by visual variant with their key computed styles and instance counts.',
    {
      site_id: z.string().optional(),
      url: z.string().optional(),
    },
    wrap(handleInventory),
  );

  server.tool(
    'scout_designmd',
    'Generate a DESIGN.md from captured patterns and tokens. Compatible with impeccable.',
    {
      site_id: z.string().optional().describe('Generate from a specific site. Omit to merge all.'),
      name: z.string().optional().describe('Name for the design system'),
      output_path: z.string().optional().describe('Where to write the file, default DESIGN.md'),
    },
    wrap(handleDesignMd),
  );

  server.tool(
    'scout_crawl',
    'Breadth-first crawl of a site\'s internal pages. Full-page screenshot + design signals per page, near-duplicate pages deduped. Feeds scout_consistency.',
    {
      url: z.string().url().describe('Start URL'),
      max_pages: z.number().optional().describe('Default 20, max 100'),
      max_depth: z.number().optional().describe('Link depth from the start URL, default 2'),
      same_origin_only: z.boolean().optional().describe('Default true'),
      include_pattern: z.string().optional().describe('Regex — only crawl matching URL paths'),
      exclude_pattern: z.string().optional().describe('Regex — skip matching URL paths'),
    },
    wrap(handleCrawl),
  );

  server.tool(
    'scout_consistency',
    'Cross-page design consistency report from a crawl: font drift, palette spread, container-width mismatch, unstable nav/footer. Returns a 0-100 score and writes an HTML report.',
    {
      crawl_id: z.string().optional().describe('Crawl to analyze; omit for the most recent'),
    },
    wrap(handleConsistency),
  );

  server.tool(
    'scout_list',
    'List captured sites (with screenshot/pattern counts) or crawls.',
    {
      kind: z.enum(['sites', 'crawls']).optional().describe('Default sites'),
      limit: z.number().optional(),
    },
    wrap(handleList),
  );

  server.tool(
    'scout_delete',
    'Delete a captured site and its patterns, tokens, and screenshot files.',
    { site_id: z.string().describe('siteId to delete') },
    wrap(handleDelete),
  );

  return server;
}

export async function startServer(config: DesignScoutConfig): Promise<void> {
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('DesignScout MCP server v0.2 running on stdio');
}
