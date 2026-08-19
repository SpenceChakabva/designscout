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
| `scout_capture` | Visit URL, auto-scroll, capture viewport screenshots |
| `scout_analyze` | Analyze captured screenshots via Claude Vision |
| `scout_search` | Query inspiration DB for patterns matching a brief |
| `scout_tokens` | Generate design token JSON from analyzed patterns |
| `scout_moodboard` | Produce an HTML mood board artifact |
| `scout_codegen` | Generate React/HTML components from inspiration |
| `scout_compare` | Side-by-side comparison of multiple site designs |

## CLI Commands (fallback)

```
designscout capture <url> [--viewport 1440x900] [--scroll-delay 500]
designscout analyze [--site <url>]
designscout search <query>
designscout tokens [--site <url>] [--format css|json|tailwind]
designscout moodboard [--sites <url1,url2>] [--output moodboard.html]
designscout codegen [--component hero|nav|card|footer] [--framework react|html]
```

## Tech Stack
- **Runtime**: Node.js / TypeScript
- **MCP SDK**: @modelcontextprotocol/sdk
- **Browser**: Playwright (Chromium headless)
- **Vision**: Anthropic Claude API (claude-sonnet-4-6)
- **Storage**: better-sqlite3
- **CLI**: commander.js
- **Output**: Handlebars templates for mood boards

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
  format TEXT DEFAULT 'json', -- json, css, tailwind
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
│   │   └── capture.ts      # Playwright scroll + screenshot logic
│   ├── analyzer/
│   │   └── vision.ts       # Claude Vision API analysis
│   ├── store/
│   │   ├── db.ts           # SQLite setup + migrations
│   │   └── queries.ts      # Query helpers
│   ├── outputs/
│   │   ├── tokens.ts       # Design token generators
│   │   ├── moodboard.ts    # Mood board HTML generator
│   │   └── codegen.ts      # React/HTML code generator
│   └── shared/
│       ├── types.ts        # Shared TypeScript types
│       └── config.ts       # Configuration + defaults
├── templates/
│   └── moodboard.hbs       # Mood board HTML template
└── data/
    └── designscout.db      # SQLite database (created at runtime)
```
