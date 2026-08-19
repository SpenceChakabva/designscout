<div align="center">

# DesignScout

**Capture. Analyze. Audit. Build.**

An MCP server that gives Claude Code a browser, a design library,
and a quality gate. No API keys.

[Install](#install) · [Tools](#tools) · [Usage](#usage) · [Contributing](CONTRIBUTING.md)

</div>

---

## What It Does

DesignScout is a design research agent for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). It runs a headless browser, captures website designs, stores the patterns in a local database, and provides tokens, mood boards, and anti-pattern auditing so the output does not look AI-generated.

**Capture** any site with Playwright. Claude Code reads the screenshots with its own vision.

**Analyze** colors, typography, layout, components, and mood. Store them locally.

**Generate** design tokens as JSON, CSS custom properties, or Tailwind config. Grays auto-tint toward the brand hue. Font stacks avoid the overused list.

**Audit** the output for AI tells. 14 deterministic rules catch overused fonts, pure grays, gradient text, em-dash density, filler phrases. No LLM needed.

**Style** three design directions from captured patterns. Refined, Bold, or Expressive. The user picks, then Claude Code builds.

Uses [Impeccable](https://github.com/pbakaus/impeccable) for design quality enforcement.

---

## Install

### Clone and build

```bash
git clone https://github.com/SpenceChakabva/designscout.git
cd designscout
npm install
npx playwright install chromium
npm run build
```

### Register with Claude Code

**Option A: CLI (recommended)**

```bash
claude mcp add designscout -s user -- node /absolute/path/to/designscout/dist/index.js
```

The `-s user` flag makes it available across all sessions.

**Option B: Manual config**

Add to `~/.claude.json` (or `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "designscout": {
      "command": "node",
      "args": ["/absolute/path/to/designscout/dist/index.js"]
    }
  }
}
```

### Verify

Restart Claude Code, then run `/mcp`. DesignScout should appear in the server list. If it shows as failed, run `claude --debug` to see the error.

---

## Tools

| Tool | What it does |
|---|---|
| `scout_capture` | Visit a URL, scroll the full page, capture viewport screenshots |
| `scout_analyze` | Return screenshot paths for Claude Code to analyze visually |
| `scout_store_patterns` | Save Claude Code's visual analysis to the database |
| `scout_search` | Query the pattern database by keyword and category |
| `scout_tokens` | Generate design tokens (JSON, CSS, or Tailwind config) |
| `scout_styles` | Generate 3 design directions: Refined, Bold, Expressive |
| `scout_moodboard` | Build an HTML mood board from captured sites |
| `scout_compare` | Compare designs across multiple captured sites |
| `scout_audit` | Check files or text for AI design and copy tells |
| `scout_designmd` | Generate an impeccable-compatible DESIGN.md |

---

## Usage

In Claude Code, use natural language:

**Capture and build:**
```
"Capture linear.app, analyze the design, and build me a landing page in that style"
```

**Three style directions:**
```
"Capture stripe.com, then show me 3 design directions based on it"
```

**Audit for AI tells:**
```
"Audit src/app/page.tsx for AI design and copy tells"
```

**Compare sites:**
```
"Capture linear.app and vercel.com, compare their design approaches"
```

**Generate a design system:**
```
"Capture stripe.com, generate a DESIGN.md from it"
```

**Full pipeline:**
```
"Capture linear.app, vercel.com, and resend.com. Analyze each,
compare them, generate 3 style directions, then build a landing
page with the one I pick. Audit the result before showing me."
```

### CLI

```bash
npx tsx src/cli.ts capture https://linear.app
npx tsx src/cli.ts list
npx tsx src/cli.ts search "dark minimal hero"
npx tsx src/cli.ts tokens --format css
npx tsx src/cli.ts moodboard --title "SaaS Inspiration"
npx tsx src/cli.ts serve
```

---

## Anti-Pattern Detection

`scout_audit` runs 14 deterministic rules across three categories:

**Design slop:** overused fonts (Inter, Roboto, Geist, etc.), cream/beige surfaces, purple/violet palettes, Tailwind default colors, gradient text, glow shadows, radial halos, side-tab borders, bounce easing.

**Copy tells:** em-dash overuse, exclamation density, ellipsis overuse, colon-header patterns, trailing arrow overuse, fake metrics, 30+ AI filler phrases.

**Quality:** pure grays without hue tint, pure black, gray text on colored backgrounds, WCAG AA contrast failures.

---

## Data

```
~/.designscout/
  designscout.db          SQLite database
  screenshots/<id>/       Captured viewport images
  outputs/                Generated mood boards
```

Set `DESIGNSCOUT_DATA` to change the location.

---

## Roadmap

- [x] CSS extraction from the DOM (computed styles, fonts, icons, animations)
- [x] Anti-pattern detection (14 rules, no LLM)
- [x] DESIGN.md generation (impeccable-compatible)
- [x] Style direction generation (Refined, Bold, Expressive)
- [ ] Mobile viewport capture mode
- [ ] Capture specific sections by CSS selector
- [ ] Web UI for browsing the inspiration database
- [ ] Figma token export
- [ ] Multi-page site crawling

---

## License

MIT
