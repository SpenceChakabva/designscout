import fs from 'node:fs';
import path from 'node:path';
import type { MoodBoard, MoodBoardEntry, DesignAnalysis, DesignTokenSet, DesignPattern, CapturedScreenshot, DesignScoutConfig } from '../shared/types.js';

/**
 * Generate a mood board HTML file from analyzed sites.
 */
export function generateMoodBoard(
  entries: MoodBoardEntry[],
  title: string,
  config: DesignScoutConfig,
  brief?: string,
): string {
  const board: MoodBoard = {
    title,
    brief,
    entries,
    generatedAt: new Date().toISOString(),
  };

  const html = renderMoodBoardHtml(board);
  const outputPath = path.join(config.outputsDir, `moodboard-${Date.now()}.html`);
  fs.writeFileSync(outputPath, html, 'utf-8');
  return outputPath;
}

/**
 * Build a mood board entry from site data.
 */
export function buildMoodBoardEntry(
  siteUrl: string,
  siteTitle: string,
  screenshots: CapturedScreenshot[],
  patterns: DesignPattern[],
  tokens?: DesignTokenSet,
): MoodBoardEntry {
  // Reconstruct a summary analysis from patterns
  const colorPattern = patterns.find(p => p.category === 'color' && p.subcategory === 'palette');
  const typoPattern = patterns.find(p => p.category === 'typography');
  const layoutPattern = patterns.find(p => p.category === 'layout');
  const moodPattern = patterns.find(p => p.category === 'mood');

  const analysis: DesignAnalysis = {
    sectionType: 'overview',
    colors: (colorPattern?.data || {}) as any,
    typography: (typoPattern?.data || {}) as any,
    layout: (layoutPattern?.data || {}) as any,
    components: [],
    mood: (moodPattern?.data as any)?.mood || 'unknown',
    signatureElement: ((moodPattern?.data as any)?.signatureElements?.[0]) || '',
  };

  // Pick up to 4 representative screenshots
  const viewportShots = screenshots
    .filter(s => s.scrollPosition >= 0)
    .slice(0, 4);

  return {
    siteUrl,
    siteTitle,
    screenshotPaths: viewportShots.map(s => s.filepath),
    analysis,
    tokens,
  };
}

function renderMoodBoardHtml(board: MoodBoard): string {
  const entriesHtml = board.entries.map((entry, i) => {
    const colors = entry.analysis.colors || {};
    const swatches = Object.entries(colors)
      .map(([name, hex]) => `
        <div class="swatch" style="background:${hex}" title="${name}: ${hex}">
          <span class="swatch-label">${name}</span>
          <span class="swatch-hex">${hex}</span>
        </div>`)
      .join('');

    const screenshots = entry.screenshotPaths
      .map(p => {
        // Convert absolute path to data URI for portability
        try {
          const data = fs.readFileSync(p);
          const b64 = data.toString('base64');
          return `<img src="data:image/png;base64,${b64}" class="screenshot" loading="lazy" />`;
        } catch {
          return `<div class="screenshot placeholder">Screenshot unavailable</div>`;
        }
      })
      .join('');

    const typo = entry.analysis.typography;
    const layout = entry.analysis.layout;

    return `
      <section class="entry">
        <div class="entry-header">
          <h2>${entry.siteTitle || 'Untitled'}</h2>
          <a href="${entry.siteUrl}" target="_blank" rel="noopener">${entry.siteUrl}</a>
        </div>

        <div class="screenshots-grid">${screenshots}</div>

        <div class="analysis-grid">
          <div class="analysis-card">
            <h3>Color Palette</h3>
            <div class="swatches">${swatches}</div>
          </div>

          <div class="analysis-card">
            <h3>Typography</h3>
            <p><strong>Headings:</strong> ${typo?.headingStyle || 'n/a'} / ${typo?.headingWeight || 'n/a'}</p>
            <p><strong>Body:</strong> ${typo?.bodyStyle || 'n/a'}</p>
            <p><strong>Scale:</strong> ${typo?.estimatedScaleRatio || 'n/a'}</p>
            <p class="notable">${typo?.notable || ''}</p>
          </div>

          <div class="analysis-card">
            <h3>Layout</h3>
            <p><strong>Structure:</strong> ${layout?.structure || 'n/a'}</p>
            <p><strong>Columns:</strong> ${layout?.columns || 'n/a'}</p>
            <p><strong>Spacing:</strong> ${layout?.spacingDensity || 'n/a'}</p>
          </div>

          <div class="analysis-card">
            <h3>Mood & Signature</h3>
            <p class="mood-tag">${entry.analysis.mood}</p>
            <p class="signature">${entry.analysis.signatureElement}</p>
          </div>
        </div>
      </section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${board.title} · DesignScout Mood Board</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; }

    :root {
      --bg: #12110f;
      --surface: #1a1815;
      --line: #322e28;
      --ink: #ece7de;
      --muted: #9a9387;
      --accent: #e8613c;
    }

    body {
      font-family: 'DM Sans', 'Satoshi', system-ui, sans-serif;
      background: var(--bg);
      color: var(--ink);
      padding: 2.5rem;
      line-height: 1.6;
    }

    .board-header {
      padding: 2rem 0 2.5rem;
      border-bottom: 2px solid var(--line);
      margin-bottom: 3rem;
    }

    .board-header h1 {
      font-family: 'Cabinet Grotesk', 'Hanken Grotesk', var(--font-heading, sans-serif);
      font-size: clamp(2rem, 5vw, 3rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      margin-bottom: 0.5rem;
    }

    .board-header .brief { color: var(--muted); max-width: 55ch; }
    .board-header .meta { font-size: 0.75rem; color: #6a655c; margin-top: 1rem; text-transform: uppercase; letter-spacing: 0.08em; }

    .entry {
      margin-bottom: 3.5rem;
      padding: 1.75rem;
      border: 2px solid var(--line);
      background: var(--surface);
    }

    .entry-header { margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
    .entry-header h2 { font-family: 'Cabinet Grotesk', 'Hanken Grotesk', sans-serif; font-size: 1.4rem; font-weight: 700; }
    .entry-header a { color: var(--muted); font-size: 0.85rem; text-decoration: none; }
    .entry-header a:hover { color: var(--accent); }

    .screenshots-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0.75rem; margin-bottom: 1.75rem; }
    .screenshot { width: 100%; border: 2px solid var(--line); object-fit: cover; object-position: top; max-height: 380px; display: block; }
    .placeholder { display: flex; align-items: center; justify-content: center; height: 180px; background: var(--bg); color: #4a463f; border: 2px dashed var(--line); }

    .analysis-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 0.75rem; }
    .analysis-card { background: var(--bg); border: 2px solid var(--line); padding: 1.1rem; }
    .analysis-card h3 { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; color: #6a655c; margin-bottom: 0.75rem; }
    .analysis-card p { font-size: 0.85rem; margin-bottom: 0.35rem; }

    .swatches { display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .swatch { width: 100%; min-width: 46px; flex: 1 1 46px; height: 46px; border: 2px solid var(--line); display: flex; flex-direction: column; justify-content: flex-end; padding: 3px; position: relative; }
    .swatch-label { display: none; }
    .swatch:hover .swatch-label { display: block; position: absolute; top: -1.4rem; left: 0; font-size: 0.6rem; color: var(--muted); white-space: nowrap; }
    .swatch-hex { font-size: 0.5rem; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.9); font-family: ui-monospace, monospace; }

    .mood-tag { display: inline-block; background: var(--accent); color: #12110f; padding: 0.2rem 0.7rem; font-size: 0.8rem; font-weight: 700; text-transform: lowercase; }
    .signature, .notable { color: var(--muted); font-style: italic; margin-top: 0.5rem; }
  </style>
</head>
<body>
  <header class="board-header">
    <h1>${board.title}</h1>
    ${board.brief ? `<p class="brief">${board.brief}</p>` : ''}
    <p class="meta">DesignScout · ${board.generatedAt}</p>
  </header>

  <main>
    ${entriesHtml}
  </main>
</body>
</html>`;
}
