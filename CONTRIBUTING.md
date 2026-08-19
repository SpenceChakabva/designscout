# Contributing to DesignScout

Thanks for your interest in contributing. Here's how to get started.

## Setup

```bash
git clone https://github.com/SpenceChakabva/designscout.git
cd designscout
npm install
npx playwright install chromium
npm run build
```

## Development

```bash
npm run dev          # MCP server with tsx (auto-reload)
npx tsc --noEmit     # Type check without building

# Run CLI directly
npx tsx src/cli.ts capture https://example.com
```

## What to Work On

- **New capture strategies** — mobile viewports, CSS selectors, multi-page crawls
- **CSS extraction from DOM** — computed styles, not just vision analysis
- **More output formats** — Figma tokens, Style Dictionary
- **Search improvements** — full-text search with better ranking
- **Web UI** — browser-based inspiration dashboard

## Pull Requests

1. Fork and branch from `main`
2. Run `npx tsc --noEmit` before pushing
3. One feature or fix per PR
4. Brief description of what changed and why

By contributing, you agree your contributions are licensed under the MIT License.
