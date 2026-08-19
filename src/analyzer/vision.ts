import type { CapturedScreenshot, DesignAnalysis, DesignPattern } from '../shared/types.js';
import { v4 as uuid } from 'uuid';

/**
 * The analysis schema prompt — returned to Claude Code so IT does the analysis.
 */
export const ANALYSIS_SCHEMA = `Analyze this website screenshot and extract structured design information.

Return ONLY valid JSON matching this schema — no markdown fences, no explanation:

{
  "sectionType": "hero | navbar | features | testimonials | footer | pricing | cta | content | gallery | form | sidebar | other",
  "colors": {
    "background": "#hex",
    "primary": "#hex",
    "secondary": "#hex",
    "accent": "#hex",
    "textPrimary": "#hex",
    "textSecondary": "#hex"
  },
  "typography": {
    "headingStyle": "serif | sans | mono | display",
    "headingWeight": "light | regular | bold | black",
    "bodyStyle": "serif | sans | mono",
    "estimatedScaleRatio": 1.25,
    "notable": "brief description of distinctive type treatment"
  },
  "layout": {
    "structure": "centered | split | grid | asymmetric | full-bleed",
    "columns": 1,
    "spacingDensity": "tight | comfortable | spacious",
    "maxWidth": "narrow | medium | wide | full"
  },
  "components": [
    {
      "type": "button | card | badge | input | nav-item | image | icon | tag | toggle | avatar",
      "styleNotes": "brief description of visual treatment"
    }
  ],
  "mood": "minimal | bold | playful | corporate | editorial | brutalist | luxury | techy | organic | retro",
  "signatureElement": "the single most distinctive design choice visible in this section"
}

Be precise with hex colors — use your best estimate from the pixels. Focus on what makes this design distinctive.`;

/**
 * Select representative screenshots and return their file paths.
 * Claude Code reads the files itself — no base64 over stdio.
 */
export function selectScreenshots(
  screenshots: CapturedScreenshot[],
  maxCount = 6,
): CapturedScreenshot[] {
  const viewportShots = screenshots.filter(s => s.scrollPosition >= 0);
  return sampleScreenshots(viewportShots, maxCount);
}

/**
 * Pick a representative sample of screenshots.
 */
function sampleScreenshots(screenshots: CapturedScreenshot[], maxCount: number): CapturedScreenshot[] {
  if (screenshots.length <= maxCount) return screenshots;

  const result: CapturedScreenshot[] = [screenshots[0]];
  const step = (screenshots.length - 1) / (maxCount - 1);

  for (let i = 1; i < maxCount - 1; i++) {
    const idx = Math.round(step * i);
    result.push(screenshots[idx]);
  }

  result.push(screenshots[screenshots.length - 1]);
  return result;
}

/**
 * Parse a JSON analysis string from Claude Code into a DesignAnalysis.
 */
export function parseAnalysis(jsonString: string): DesignAnalysis {
  const cleaned = jsonString.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned) as DesignAnalysis;
}

/**
 * Convert raw DesignAnalysis objects into storable patterns.
 */
export function extractPatterns(analyses: DesignAnalysis[], siteId: string): DesignPattern[] {
  const patterns: DesignPattern[] = [];

  // Aggregate colors across sections
  const colorSets = analyses.map(a => a.colors);
  if (colorSets.length > 0) {
    patterns.push({
      id: uuid(),
      siteId,
      category: 'color',
      subcategory: 'palette',
      data: colorSets[0],
      description: `Primary palette: bg ${colorSets[0].background}, primary ${colorSets[0].primary}, accent ${colorSets[0].accent}`,
      confidence: 0.85,
    });

    const uniqueBgs = [...new Set(colorSets.map(c => c.background))];
    if (uniqueBgs.length > 1) {
      patterns.push({
        id: uuid(),
        siteId,
        category: 'color',
        subcategory: 'contrast-sections',
        data: { backgrounds: uniqueBgs, sections: analyses.map(a => ({ section: a.sectionType, bg: a.colors.background })) },
        description: `Uses ${uniqueBgs.length} distinct background tones across sections`,
        confidence: 0.8,
      });
    }
  }

  // Typography patterns
  const typoSets = analyses.map(a => a.typography);
  if (typoSets.length > 0) {
    patterns.push({
      id: uuid(),
      siteId,
      category: 'typography',
      subcategory: 'system',
      data: typoSets[0],
      description: `${typoSets[0].headingStyle} headings (${typoSets[0].headingWeight}), ${typoSets[0].bodyStyle} body. ${typoSets[0].notable}`,
      confidence: 0.8,
    });
  }

  // Layout patterns per section
  for (const analysis of analyses) {
    patterns.push({
      id: uuid(),
      siteId,
      category: 'layout',
      subcategory: analysis.sectionType,
      data: analysis.layout,
      description: `${analysis.sectionType}: ${analysis.layout.structure} layout, ${analysis.layout.columns} col, ${analysis.layout.spacingDensity} spacing`,
      confidence: 0.75,
    });
  }

  // Component patterns
  const allComponents = analyses.flatMap(a => a.components);
  const componentTypes = [...new Set(allComponents.map(c => c.type))];
  for (const type of componentTypes) {
    const instances = allComponents.filter(c => c.type === type);
    patterns.push({
      id: uuid(),
      siteId,
      category: 'component',
      subcategory: type,
      data: { instances: instances.map(c => c.styleNotes) },
      description: `${type}: ${instances[0].styleNotes}`,
      confidence: 0.7,
    });
  }

  // Overall mood
  const moods = analyses.map(a => a.mood);
  const moodCounts = moods.reduce((acc, m) => ({ ...acc, [m]: (acc[m] || 0) + 1 }), {} as Record<string, number>);
  const dominantMood = Object.entries(moodCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || 'unknown';
  const signatures = analyses.map(a => a.signatureElement).filter(Boolean);

  patterns.push({
    id: uuid(),
    siteId,
    category: 'mood',
    subcategory: dominantMood,
    data: { mood: dominantMood, moodDistribution: moodCounts, signatureElements: signatures },
    description: `Overall mood: ${dominantMood}. Signature elements: ${signatures.slice(0, 3).join('; ')}`,
    confidence: 0.8,
  });

  return patterns;
}
