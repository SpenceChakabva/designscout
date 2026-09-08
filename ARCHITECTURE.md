# DesignScout — Architecture

## What it does
A design research agent that browses websites, captures and analyzes their visual design,
builds an inspiration database, and collaborates with Claude Code to produce design tokens,
mood boards, and production code for new sites.

## Integration
- **Primary**: MCP server that Claude Code calls as a tool
- **Fallback**: CLI tool for standalone use / piping context

## Core Pipeline

```
URL → [Browser Engine] → Screenshots + DOM data
         ↓
    [Vision Analyzer] → Structured design patterns (JSON)
         ↓
    [Inspiration Store] → SQLite DB of patterns, tokens, components
         ↓
    [Output Generators] → Design tokens | Mood board HTML | React/HTML code
```

## MCP Tools Exposed

| Tool | Description |
|------|-------------|
| `scout_capture` | Visit URL, auto-scroll, capture viewport screenshots. Responsive multi-viewport, selector-scoped capture, layout-breakage detection, banner dismissal, DOM style extraction, raw HTML persisted for later audit |
| `scout_analyze` | Return screenshot paths + schema; Claude Code does the vision pass |
| `scout_store_patterns` | Persist Claude Code's structured analysis |
| `scout_search` | Query inspiration DB for patterns matching a brief |
| `scout_tokens` | Generate tokens: json / css / tailwind / style-dictionary / w3c / figma |
| `scout_styles` | Three token sets: Refined, Bold, Expressive |
| `scout_codegen` | Generate a React/HTML component from a token set, pre-checked against the audit rules |
| `scout_moodboard` | Produce an HTML mood board artifact |
| `scout_compare` | Side-by-side comparison of multiple site designs |
| `scout_audit` | Deterministic anti-pattern detection on a file, text, or captured site |
| `scout_a11y` | Deterministic accessibility scan with a 0-100 score |
| `scout_inventory` | Component inventory from the live DOM |
| `scout_designmd` | impeccable-compatible DESIGN.md |
| `scout_crawl` | BFS crawl of internal pages with per-page signals + dedupe |
| `scout_consistency` | Cross-page design consistency report (HTML + JSON) |
| `scout_list` / `scout_delete` | Site & crawl management |

## CLI Commands (fallback)

Every tool has a matching subcommand. Highlights:

```
designscout capture <url> [--responsive] [--viewports mobile,desktop] [--selector "nav"]
designscout analyze [--site-id <id> | --url <url>]
designscout store-patterns <siteId> <file.json|jsonString>
designscout tokens [--site-id <id>] [--format json|css|tailwind|style-dictionary|w3c|figma]
designscout styles [--site-id <id>] [--brief <text>]
designscout codegen <hero|navbar|card|footer|features|testimonials|cta|pricing> [--framework react|html] [-o path]
designscout audit [--file <path> | --text <s> | --site-id <id> | --url <url>] [--check <cat|ruleId>]
designscout a11y [--site-id <id> | --url <url>]
designscout inventory [--site-id <id> | --url <url>]
designscout crawl <url> [--max-pages 20] [--max-depth 2] [--include <re>] [--exclude <re>]
designscout consistency [--crawl-id <id>]
designscout moodboard [--site-ids <id1,id2>] [--title <t>]
designscout list [--kind sites|crawls]
designscout delete <siteId>
designscout serve
```

## Tech Stack
- **Runtime**: Node.js 20+ / TypeScript (ESM)
- **MCP SDK**: @modelcontextprotocol/sdk (+ zod schemas)
- **Browser**: Playwright (Chromium headless)
- **Vision**: none — Claude Code reads the screenshot files itself
- **Storage**: better-sqlite3 (migrated schema, `user_version` pragma)
- **CLI**: commander.js
- **Tests**: `node:test` via tsx (`npm test`)
- **Output**: string-built HTML for mood boards & consistency reports

## Browser layer (`src/browser/`)
- `session.ts` — `withBrowser`, context creation (with a `__name` shim so
  esbuild/tsx-transformed extractor functions survive `page.evaluate`),
  `gotoWithRetry` (exponential backoff), `dismissOverlays`
- `capture.ts` — per-viewport orchestration: lazy-load scroll, DOM data grab,
  overlapping frame capture, full-page + selector modes
- `extract.ts` — serialized in-page scripts: style extraction, layout-issue
  detection, component inventory, accessibility scan
- `crawl.ts` — BFS link discovery, structural fingerprint dedupe, per-page signals
- `inspect.ts` — load once, run an arbitrary in-page evaluator (inventory / a11y)

## Data Model (SQLite)

```sql
-- Captured sites
CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT,
  captured_at TEXT DEFAULT (datetime('now')),
  viewport TEXT DEFAULT '1440x900',
  metadata TEXT -- JSON blob
);

-- Screenshots per site
CREATE TABLE screenshots (
  id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES sites(id),
  scroll_position INTEGER,
  filepath TEXT NOT NULL,
  section_label TEXT, -- hero, nav, footer, etc.
  width INTEGER,
  height INTEGER
);

-- Extracted design patterns
CREATE TABLE patterns (
  id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES sites(id),
  category TEXT NOT NULL, -- color, typography, layout, component, spacing
  subcategory TEXT,       -- e.g. "hero", "navbar", "card-grid"
  data TEXT NOT NULL,     -- JSON: extracted pattern details
  description TEXT,       -- natural language description
  confidence REAL DEFAULT 0.0
);

-- Generated design tokens
CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES sites(id),
  token_set TEXT NOT NULL, -- JSON: full token set
  format TEXT DEFAULT 'json',
  generated_at TEXT DEFAULT (datetime('now'))
);

-- schema v1: screenshots gain device_type, viewport_label

-- schema v2: crawl support
CREATE TABLE crawls (
  id TEXT PRIMARY KEY,
  start_url TEXT NOT NULL,
  data TEXT NOT NULL,          -- JSON: full CrawlResult
  generated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  crawl_id TEXT REFERENCES crawls(id) ON DELETE CASCADE,
  site_id TEXT REFERENCES sites(id) ON DELETE SET NULL,
  url TEXT NOT NULL, path TEXT, depth INTEGER,
  title TEXT, fingerprint TEXT, duplicate_of TEXT
);
CREATE TABLE audits (
  id TEXT PRIMARY KEY,
  site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
  target TEXT,
  data TEXT NOT NULL,          -- JSON: summary + findings (or a11y report)
  generated_at TEXT DEFAULT (datetime('now'))
);
```

## Vision Analysis Schema

When Claude Vision analyzes a screenshot, it returns:

```json
{
  "section_type": "hero | navbar | features | testimonials | footer | ...",
  "colors": {
    "background": "#hex",
    "primary": "#hex",
    "secondary": "#hex",
    "accent": "#hex",
    "text_primary": "#hex",
    "text_secondary": "#hex"
  },
  "typography": {
    "heading_style": "serif | sans | mono | display",
    "heading_weight": "light | regular | bold | black",
    "body_style": "serif | sans | mono",
    "estimated_scale_ratio": 1.25,
    "notable": "description of type treatment"
  },
  "layout": {
    "structure": "centered | split | grid | asymmetric | full-bleed",
    "columns": 1,
    "spacing_density": "tight | comfortable | spacious",
    "max_width": "narrow | medium | wide | full"
  },
  "components": [
    {
      "type": "button | card | badge | input | nav-item | ...",
      "style_notes": "description of the component's visual treatment"
    }
  ],
  "mood": "minimal | bold | playful | corporate | editorial | brutalist | ...",
  "signature_element": "the single most distinctive design choice on this section"
}
```

## File Structure

```
designscout/
├── package.json
├── tsconfig.json
├── ARCHITECTURE.md
├── src/
│   ├── index.ts            # MCP server entry
│   ├── cli.ts              # CLI entry
│   ├── mcp/
│   │   ├── server.ts       # MCP server setup + tool registration
│   │   └── tools.ts        # Tool handler implementations
│   ├── browser/
│   │   ├── session.ts      # browser lifecycle, retry nav, overlay dismissal
│   │   ├── capture.ts      # scroll + screenshot orchestration
│   │   ├── extract.ts      # in-page extractors (styles, layout, inventory, a11y)
│   │   ├── crawl.ts        # BFS multi-page crawl + dedupe
│   │   └── inspect.ts      # load-once + run an in-page evaluator
│   ├── analyzer/
│   │   └── vision.ts       # analysis schema + pattern extraction
│   ├── audit/
│   │   ├── rules.ts        # ~25 deterministic anti-pattern rules
│   │   └── a11y.ts         # accessibility report + scoring
│   ├── store/
│   │   ├── db.ts           # SQLite setup + versioned migrations
│   │   └── queries.ts      # query helpers
│   ├── outputs/
│   │   ├── tokens.ts       # token generators (6 formats)
│   │   ├── moodboard.ts    # mood board HTML
│   │   ├── codegen.ts      # React/HTML component generator
│   │   ├── consistency.ts  # cross-page consistency report
│   │   └── designmd.ts     # DESIGN.md generator
│   ├── shared/
│   │   ├── types.ts        # shared types
│   │   └── config.ts       # config, viewport presets, env knobs
│   └── **/*.test.ts        # node:test suites
└── ~/.designscout/
    ├── designscout.db      # SQLite database (created at runtime)
    ├── screenshots/        # per-site + per-crawl images, page.html
    └── outputs/            # mood boards, consistency reports
```
