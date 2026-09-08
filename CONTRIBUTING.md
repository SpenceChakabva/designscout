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

## Tests

```bash
npm test             # node:test suites via tsx
```

Add a `*.test.ts` next to the module you change. Audit rules, token formats, and
codegen output all have coverage — keep it green.

## What to Work On

- **Web UI** — browser-based inspiration dashboard
- **Visual regression** — diff two captures of the same URL
- **More audit rules** — every new AI tell you can pin down deterministically
- **Search improvements** — full-text search with better ranking
- **Crawl heuristics** — smarter near-duplicate detection, sitemap support

## Pull Requests

1. Fork and branch from `main`
2. Run `npx tsc --noEmit` and `npm test` before pushing
3. One feature or fix per PR
4. Brief description of what changed and why

By contributing, you agree your contributions are licensed under the MIT License.
