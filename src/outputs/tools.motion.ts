import fs from 'node:fs';
import nodePath from 'node:path';
import type { DesignScoutConfig } from '../shared/types.js';
import { getDb } from '../store/db.js';
import * as queries from '../store/queries.js';
import {
  generateMotionLayer,
  describeDetected,
  MOTION_EFFECTS,
  type MotionEffect,
  type MotionLibrary,
  type ThemeTransition,
  type DetectedMotion,
} from './motion.js';

// All tools return plain text — no base64 images over stdio.
type ToolResult = { content: { type: 'text'; text: string }[] };

function textResult(data: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

const THEME_TRANSITIONS: ThemeTransition[] = ['none', 'fade', 'iris', 'wipe'];

export interface MotionArgs {
  site_id?: string;
  library?: string;
  effects?: string[];
  smooth_scroll?: boolean;
  theme_transition?: string;
  brief?: string;
  output_dir?: string;
}

/**
 * scout_motion — emit the guarded scroll/reveal/parallax/theme-transition layer
 * that otherwise gets hand-written on every build. Consumes a captured site's
 * detected animation signals (via site_id) to pick sensible defaults.
 */
export async function handleMotion(
  args: MotionArgs,
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const library: MotionLibrary | undefined =
    args.library === 'gsap' ? 'gsap' : args.library === 'none' ? 'none' : undefined;
  if (args.library && !library) {
    return textResult({ success: false, error: `library must be "none" or "gsap".` });
  }

  const themeTransition: ThemeTransition | undefined = THEME_TRANSITIONS.includes(
    args.theme_transition as ThemeTransition,
  )
    ? (args.theme_transition as ThemeTransition)
    : undefined;
  if (args.theme_transition && !themeTransition) {
    return textResult({ success: false, error: `theme_transition must be one of: ${THEME_TRANSITIONS.join(', ')}` });
  }

  let requestedEffects: MotionEffect[] | undefined;
  if (Array.isArray(args.effects)) {
    requestedEffects = args.effects.filter((e): e is MotionEffect =>
      (MOTION_EFFECTS as string[]).includes(e),
    );
    const unknown = args.effects.filter(e => !(MOTION_EFFECTS as string[]).includes(e));
    if (unknown.length && requestedEffects.length === 0) {
      return textResult({
        success: false,
        error: `No valid effects. Known effects: ${MOTION_EFFECTS.join(', ')}. Got: ${unknown.join(', ')}`,
      });
    }
  }

  let detected: DetectedMotion | undefined;
  let detectedFromPatterns = 0;
  if (args.site_id) {
    const db = getDb(config);
    const site = queries.getSite(db, args.site_id);
    if (!site) {
      return textResult({ success: false, error: `Site ${args.site_id} not found. Run scout_capture first.` });
    }
    const patterns = queries.getPatternsForSite(db, args.site_id);
    detectedFromPatterns = patterns.length;
    detected = describeDetected(patterns);
  }

  const layer = generateMotionLayer({
    library,
    effects: requestedEffects,
    smoothScroll: args.smooth_scroll,
    themeTransition,
    brief: args.brief,
    detected,
  });

  const resolvedLibrary: MotionLibrary = library ?? detected?.suggestedLibrary ?? 'none';

  let written: { css: string; js: string } | undefined;
  if (args.output_dir) {
    try {
      fs.mkdirSync(args.output_dir, { recursive: true });
      const cssPath = nodePath.join(args.output_dir, 'motion.css');
      const jsPath = nodePath.join(args.output_dir, 'motion.js');
      fs.writeFileSync(cssPath, layer.css, 'utf-8');
      fs.writeFileSync(jsPath, layer.js, 'utf-8');
      written = { css: cssPath, js: jsPath };
    } catch {
      /* fall back to inline output */
    }
  }

  const guardNote =
    `The layer is guarded: the controller hard-bails with all content visible under prefers-reduced-motion` +
    (resolvedLibrary === 'gsap' ? ` or when window.gsap is absent` : ``) +
    `, and applies resting opacity:0 only after JS adds html.anim-ready.`;

  return textResult({
    success: true,
    library: resolvedLibrary,
    effects: layer.effects,
    smoothScroll: (args.smooth_scroll ?? detected?.smoothScroll ?? false) && resolvedLibrary === 'gsap',
    themeTransition: themeTransition ?? 'none',
    detectedFromSite: args.site_id
      ? { siteId: args.site_id, patternsScanned: detectedFromPatterns, detected }
      : null,
    notes: layer.notes,
    outputDir: written ? args.output_dir : null,
    files: written ?? null,
    css: written ? undefined : layer.css,
    js: written ? undefined : layer.js,
    html: layer.html,
    message:
      `Motion layer generated (${resolvedLibrary} build) with ${layer.effects.length} effect(s): ` +
      `${layer.effects.join(', ')}. ${guardNote} ` +
      (written
        ? `Wrote ${written.css} and ${written.js}.`
        : `Returned inline as css / js / html.`),
  });
}
