/**
 * scout_contrast — MCP tool handler.
 *
 * Four modes, resolved in order:
 *   1. `foreground` + `background`  → classify that single pair (+ fix if failing)
 *   2. `css` or `file_path`         → parse fg/bg pairs from CSS and classify each
 *   3. `site_id` / latest patterns  → audit the token set's text/surface pairings,
 *      run a light↔dark theme-pair report (dark from `dark_site_id` or synthesized)
 */

import fs from 'node:fs';
import type { DesignScoutConfig, DesignTokenSet } from '../shared/types.js';
import { getDb } from '../store/db.js';
import * as queries from '../store/queries.js';
import { generateTokens } from './tokens.js';
import {
  classifyPair,
  suggestFix,
  auditThemePair,
  synthesizeDarkTokens,
  extractColorPairsFromCss,
  type ContrastFix,
} from './contrast.js';

type ToolResult = { content: { type: 'text'; text: string }[] };

function textResult(data: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export interface ContrastArgs {
  site_id?: string;
  file_path?: string;
  css?: string;
  foreground?: string;
  background?: string;
  dark_site_id?: string;
  large_text?: boolean;
}

interface CssPairResult {
  selector: string;
  fg: string;
  bg: string;
  source: string;
  ratio?: number;
  AA?: boolean;
  AALarge?: boolean;
  AAA?: boolean;
  passes?: boolean;
  fix?: ContrastFix;
  error?: string;
}

function safeRead(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

function safeFix(fg: string, bg: string, target: number): ContrastFix | undefined {
  try {
    return suggestFix(fg, bg, { target });
  } catch {
    return undefined;
  }
}

export async function handleContrast(
  args: ContrastArgs,
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const target = args.large_text ? 3 : 4.5;

  // ── Mode 1: single explicit pair ──
  if (args.foreground && args.background) {
    try {
      const cls = classifyPair(args.foreground, args.background, { largeText: args.large_text });
      const fix = cls.AA ? undefined : safeFix(args.foreground, args.background, target);
      return textResult({
        success: true,
        mode: 'pair',
        pair: { fg: args.foreground, bg: args.background, ...cls },
        fix,
        message:
          `${args.foreground} on ${args.background}: ${cls.ratio}:1 — ` +
          `${cls.AA ? 'passes' : 'fails'} WCAG AA ${args.large_text ? 'large' : 'body'} text` +
          (fix ? `. Try ${fix.direction} foreground ${fix.fg} (${fix.ratio}:1)` : '') +
          '.',
      });
    } catch (err) {
      return textResult({ success: false, error: `Could not parse colors: ${(err as Error).message}` });
    }
  }

  // ── Mode 2: CSS / file ──
  const cssInput = args.css != null ? args.css : args.file_path ? safeRead(args.file_path) : null;
  if (cssInput != null) {
    if (!cssInput.trim()) {
      return textResult({
        success: false,
        error: args.file_path ? `Empty or unreadable file: ${args.file_path}` : 'Empty css argument.',
      });
    }
    const { pairs, notes } = extractColorPairsFromCss(cssInput);
    const classified: CssPairResult[] = pairs.map((p) => {
      try {
        const cls = classifyPair(p.fg, p.bg, { largeText: args.large_text });
        const fix = cls.AA ? undefined : safeFix(p.fg, p.bg, target);
        return { ...p, ratio: cls.ratio, AA: cls.AA, AALarge: cls.AALarge, AAA: cls.AAA, passes: cls.AA, fix };
      } catch {
        return { ...p, error: 'unparseable color' };
      }
    });
    const rated = classified.filter((c) => typeof c.ratio === 'number');
    const failures = classified.filter((c) => c.passes === false);
    const worst = rated.length
      ? rated.reduce((a, b) => ((b.ratio ?? Infinity) < (a.ratio ?? Infinity) ? b : a))
      : null;
    return textResult({
      success: true,
      mode: 'css',
      source: args.file_path || 'inline css',
      pairsChecked: classified.length,
      failureCount: failures.length,
      worst: worst ? { selector: worst.selector, ratio: worst.ratio } : null,
      pairs: classified,
      notes,
      message:
        `Checked ${classified.length} colour pair(s) from ${args.file_path || 'inline CSS'}: ` +
        `${failures.length} fail WCAG AA ${args.large_text ? 'large' : 'body'} text` +
        (worst && typeof worst.ratio === 'number' ? `, worst ${worst.ratio}:1 (${worst.selector})` : '') +
        '.',
    });
  }

  // ── Mode 3: token-set + theme-pair audit ──
  const db = getDb(config);
  const patterns = args.site_id
    ? queries.getPatternsForSite(db, args.site_id)
    : queries.listSites(db, 5).flatMap((s) => queries.getPatternsForSite(db, s.id));
  if (patterns.length === 0) {
    return textResult({
      success: false,
      error:
        'No patterns found. Run scout_capture → scout_analyze → scout_store_patterns first, ' +
        'or pass foreground+background, or css/file_path.',
    });
  }

  const light = generateTokens(patterns);

  let dark: DesignTokenSet;
  let darkSynthesized = false;
  if (args.dark_site_id) {
    const darkPatterns = queries.getPatternsForSite(db, args.dark_site_id);
    if (darkPatterns.length === 0) {
      return textResult({ success: false, error: `No patterns for dark_site_id ${args.dark_site_id}.` });
    }
    dark = generateTokens(darkPatterns);
  } else {
    dark = synthesizeDarkTokens(light);
    darkSynthesized = true;
  }

  const report = auditThemePair(light, dark, { largeText: args.large_text });
  const pairsChecked = report.light.pairs.length + report.dark.pairs.length;

  return textResult({
    success: true,
    mode: 'tokens',
    siteId: args.site_id || null,
    darkThemeSource: darkSynthesized
      ? 'synthesized (light-set HSL lightness inverted — verify against a real dark capture / dark_site_id)'
      : `dark_site_id ${args.dark_site_id}`,
    lightColors: light.colors,
    darkColors: dark.colors,
    report,
    message:
      `Checked ${pairsChecked} text/surface pair(s) across light + ${darkSynthesized ? 'synthesized ' : ''}dark themes: ` +
      `${report.failures.length} WCAG failure(s), ${report.regressions.length} cross-theme regression(s)` +
      (report.worst ? `, worst ${report.worst.ratio}:1 (${report.worst.theme} ${report.worst.name})` : '') +
      '.',
  });
}
