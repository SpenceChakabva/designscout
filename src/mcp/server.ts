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
} from './tools.js';

export function createServer(config: DesignScoutConfig): McpServer {
  const server = new McpServer({
    name: 'designscout',
    version: '0.1.0',
  });

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
    'Visit a website, auto-scroll, and capture viewport screenshots. Returns file paths to the screenshots so you can read them.',
    {
      url: z.string().url().describe('The website URL to capture'),
      viewport: z.string().optional().describe('Viewport size as "WIDTHxHEIGHT", default "1440x900"'),
      scroll_delay: z.number().optional().describe('Milliseconds between scroll steps, default 400'),
      max_scrolls: z.number().optional().describe('Maximum scroll captures, default 30'),
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
    'Search the inspiration database for design patterns.',
    {
      query: z.string().describe('What to search for (e.g. "dark hero", "pill buttons")'),
      category: z.enum(['color', 'typography', 'layout', 'component', 'spacing', 'mood']).optional(),
    },
    wrap(handleSearch),
  );

  server.tool(
    'scout_tokens',
    'Generate design tokens (JSON, CSS custom properties, or Tailwind config) from stored patterns.',
    {
      site_id: z.string().optional().describe('Specific site, or omit to merge all'),
      format: z.enum(['json', 'css', 'tailwind']).optional().describe('Output format, default json'),
    },
    wrap(handleTokens),
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
    'Run anti-pattern detection on files, generated tokens, or copy text. Catches AI design tells (overused fonts, pure grays, cream palettes) and AI copy tells (em-dash overuse, filler phrases, exclamation density). No LLM needed — deterministic rules only.',
    {
      file_path: z.string().optional().describe('Path to an HTML/CSS/JSX file to audit'),
      text: z.string().optional().describe('Raw text/copy to check for AI writing tells'),
      site_id: z.string().optional().describe('Audit the stored tokens for a captured site'),
      check: z.string().optional().describe('Filter to one category: slop, copy, quality — or a specific rule ID'),
    },
    wrap(handleAudit),
  );

  server.tool(
    'scout_designmd',
    'Generate a DESIGN.md from captured patterns and tokens. Compatible with impeccable so any AI coding tool can enforce the design system.',
    {
      site_id: z.string().optional().describe('Generate from a specific site. Omit to merge all.'),
      name: z.string().optional().describe('Name for the design system'),
      output_path: z.string().optional().describe('Where to write the file, default DESIGN.md'),
    },
    wrap(handleDesignMd),
  );

  server.tool(
    'scout_styles',
    'Generate 3 distinct design directions (Refined, Bold, Expressive) from captured patterns. Each comes with its own token set. Present all three and let the user pick before building.',
    {
      site_id: z.string().optional().describe('Base patterns on a specific site, or omit to merge all'),
      brief: z.string().optional().describe('Project context to guide the directions'),
    },
    wrap(handleStyles),
  );

  return server;
}

export async function startServer(config: DesignScoutConfig): Promise<void> {
  const server = createServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('DesignScout MCP server running on stdio');
}
