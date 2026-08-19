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
            <p><strong>Headings:</strong> ${typo?.headingStyle || '—'} / ${typo?.headingWeight || '—'}</p>
            <p><strong>Body:</strong> ${typo?.bodyStyle || '—'}</p>
            <p><strong>Scale:</strong> ${typo?.estimatedScaleRatio || '—'}</p>
            <p class="notable">${typo?.notable || ''}</p>
          </div>

          <div class="analysis-card">
            <h3>Layout</h3>
            <p><strong>Structure:</strong> ${layout?.structure || '—'}</p>
            <p><strong>Columns:</strong> ${layout?.columns || '—'}</p>
            <p><strong>Spacing:</strong> ${layout?.spacingDensity || '—'}</p>
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
  <title>${board.title} — DesignScout Mood Board</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; }

    body {
      font-family: 'Inter', system-ui, sans-serif;
      background: #0a0a0a;
      color: #e5e5e5;
      padding: 2rem;
      line-height: 1.6;
    }

    .board-header {
      text-align: center;
      padding: 3rem 1rem;
      border-bottom: 1px solid #222;
      margin-bottom: 3rem;
    }

    .board-header h1 {
      font-size: 2.5rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 0.5rem;
    }

    .board-header .brief {
      color: #999;
      max-width: 600px;
      margin: 0 auto;
    }

    .board-header .meta {
      font-size: 0.75rem;
      color: #555;
      margin-top: 1rem;
    }

    .entry {
      margin-bottom: 4rem;
      padding-bottom: 4rem;
      border-bottom: 1px solid #1a1a1a;
    }

    .entry-header {
      margin-bottom: 1.5rem;
    }

    .entry-header h2 {
      font-size: 1.5rem;
      font-weight: 600;
    }

    .entry-header a {
      color: #666;
      font-size: 0.875rem;
      text-decoration: none;
    }
    .entry-header a:hover { color: #999; }

    .screenshots-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .screenshot {
      width: 100%;
      border-radius: 8px;
      border: 1px solid #222;
      object-fit: cover;
      max-height: 400px;
    }

    .placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 200px;
      background: #111;
      color: #444;
      border-radius: 8px;
    }

    .analysis-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
    }

    .analysis-card {
      background: #111;
      border: 1px solid #1a1a1a;
      border-radius: 12px;
      padding: 1.25rem;
    }

    .analysis-card h3 {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #555;
      margin-bottom: 0.75rem;
    }

    .analysis-card p {
      font-size: 0.875rem;
      margin-bottom: 0.35rem;
    }

    .swatches {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .swatch {
      width: 52px;
      height: 52px;
      border-radius: 8px;
      border: 1px solid #333;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      padding: 2px;
      position: relative;
      cursor: pointer;
    }

    .swatch-label {
      display: none;
    }

    .swatch:hover .swatch-label {
      display: block;
      position: absolute;
      top: -1.5rem;
      font-size: 0.6rem;
      color: #aaa;
      white-space: nowrap;
    }

    .swatch-hex {
      font-size: 0.55rem;
      color: #fff;
      text-shadow: 0 1px 2px rgba(0,0,0,0.8);
    }

    .mood-tag {
      display: inline-block;
      background: #1a1a2e;
      color: #7c8cf8;
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      font-size: 0.875rem;
      font-weight: 500;
    }

    .signature {
      color: #888;
      font-style: italic;
      margin-top: 0.5rem;
    }

    .notable {
      color: #888;
      font-style: italic;
    }
  </style>
</head>
<body>
  <header class="board-header">
    <h1>${board.title}</h1>
    ${board.brief ? `<p class="brief">${board.brief}</p>` : ''}
    <p class="meta">Generated by DesignScout · ${board.generatedAt}</p>
  </header>

  <main>
    ${entriesHtml}
  </main>
</body>
</html>`;
}
