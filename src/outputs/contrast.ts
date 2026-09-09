/**
 * WCAG 2.1 contrast computation for DesignScout.
 *
 * Pure computation — no network, no browser. Everything here is deterministic:
 * relative-luminance ratios, AA/AAA classification, a lightness-nudging fix
 * suggester, and token-set / cross-theme auditors.
 *
 * WCAG thresholds:
 *   - AA  normal text  4.5:1
 *   - AA  large text   3.0:1   (>= 18.66px bold, or >= 24px regular)
 *   - AAA normal text  7.0:1
 *   - AAA large text   4.5:1
 *   - Non-text UI (borders, focus rings, icons)  3.0:1
 */

import type { DesignTokenSet } from '../shared/types.js';

// ── Public types ──

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface PairClassification {
  /** Contrast ratio, rounded to 2 decimals. */
  ratio: number;
  /** AA verdict. Uses the 3.0 threshold when `largeText`, else 4.5. */
  AA: boolean;
  /** AAA verdict. Uses the 4.5 threshold when `largeText`, else 7.0. */
  AAA: boolean;
  /** AA verdict against the large-text threshold (3.0), regardless of options. */
  AALarge: boolean;
  /** AAA verdict against the large-text threshold (4.5), regardless of options. */
  AAALarge: boolean;
}

export interface ContrastFix {
  /** Which side the suggestion moves. */
  movedChannel: 'foreground' | 'background';
  /** Direction the foreground was nudged. */
  direction: 'lighter' | 'darker';
  /** Suggested foreground hex (equal to the input if it already passed). */
  fg: string;
  /** Suggested background hex — only offered for fill pairs (fg is a brand fill). */
  bg?: string;
  /** Ratio achieved by the foreground suggestion. */
  ratio: number;
  /** Set when the foreground alone can't reach the target. */
  note?: string;
}

export type PairRole = 'body' | 'large' | 'ui';

export interface ContrastPairResult {
  name: string;
  fg: string;
  bg: string;
  ratio: number;
  level: 'AAA' | 'AA' | 'AA Large' | 'fail';
  passes: boolean;
  role: PairRole;
  fix?: ContrastFix;
}

export interface TokenContrastReport {
  pairs: ContrastPairResult[];
  failures: ContrastPairResult[];
  worst: { name: string; ratio: number } | null;
  skipped: { name: string; reason: string }[];
}

export interface ThemePairReport {
  light: TokenContrastReport;
  dark: TokenContrastReport;
  /** Pairs whose pass/fail verdict differs between the two themes. */
  regressions: { name: string; lightRatio: number; darkRatio: number; failsIn: 'light' | 'dark' }[];
  failures: { theme: 'light' | 'dark'; name: string; ratio: number }[];
  worst: { theme: 'light' | 'dark'; name: string; ratio: number } | null;
}

export interface CssColorPair {
  selector: string;
  fg: string;
  bg: string;
  source: 'rule' | 'custom-property';
}

// ── Color parsing ──

const NAMED: Record<string, Rgb> = {
  white: { r: 255, g: 255, b: 255 },
  black: { r: 0, g: 0, b: 0 },
};

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHex(input: string): { r: number; g: number; b: number; a: number } | null {
  let s = input.replace(/^#/, '').trim();
  if (!/^[0-9a-fA-F]+$/.test(s)) return null;
  if (s.length === 3 || s.length === 4) s = s.split('').map((c) => c + c).join('');
  if (s.length !== 6 && s.length !== 8) return null;
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
    a: s.length === 8 ? parseInt(s.slice(6, 8), 16) / 255 : 1,
  };
}

function parseRgbFunc(input: string): { r: number; g: number; b: number; a: number } | null {
  const m = input.match(/^rgba?\(\s*([^)]+)\)$/i);
  if (!m) return null;
  const parts = m[1].split(/[,/\s]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const chan = (p: string) => (p.endsWith('%') ? parseFloat(p) * 2.55 : parseFloat(p));
  const r = chan(parts[0]);
  const g = chan(parts[1]);
  const b = chan(parts[2]);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  let a = 1;
  if (parts[3] != null) a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  if (Number.isNaN(a)) a = 1;
  return { r, g, b, a };
}

/**
 * Parse a CSS color to an opaque {r,g,b}. Handles `#rgb`, `#rgba`, `#rrggbb`,
 * `#rrggbbaa`, `rgb()/rgba()` (space or comma syntax) and the named colors
 * `white` / `black`. A translucent color is composited over `over` (default
 * white). `transparent` and anything else returns `null` (caller should skip).
 */
export function parseColor(input: string, over = '#ffffff'): Rgb | null {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return null;
  if (NAMED[s]) return { ...NAMED[s] };

  let raw: { r: number; g: number; b: number; a: number } | null = null;
  if (s.startsWith('#')) raw = parseHex(s);
  else if (s.startsWith('rgb')) raw = parseRgbFunc(s);
  else if (/^[0-9a-f]{3,8}$/.test(s)) raw = parseHex(s);
  if (!raw) return null;

  if (raw.a >= 1) return { r: clampByte(raw.r), g: clampByte(raw.g), b: clampByte(raw.b) };

  const bg = parseColor(over) ?? { r: 255, g: 255, b: 255 };
  const a = Math.max(0, Math.min(1, raw.a));
  return {
    r: clampByte(raw.r * a + bg.r * (1 - a)),
    g: clampByte(raw.g * a + bg.g * (1 - a)),
    b: clampByte(raw.b * a + bg.b * (1 - a)),
  };
}

// ── Luminance & ratio ──

/** WCAG 2.1 relative luminance. Throws on an unparseable color. */
export function relativeLuminance(color: string): number {
  const rgb = parseColor(color);
  if (!rgb) throw new Error(`unparseable color: ${color}`);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
}

/** WCAG 2.1 contrast ratio (1–21). Throws if either color is unparseable. */
export function contrastRatio(color1: string, color2: string): number {
  const l1 = relativeLuminance(color1);
  const l2 = relativeLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Classify a foreground/background pair against the WCAG thresholds.
 * `AA`/`AAA` follow the `largeText` option; `AALarge`/`AAALarge` always report
 * the large-text thresholds.
 */
export function classifyPair(
  fg: string,
  bg: string,
  opts: { largeText?: boolean } = {},
): PairClassification {
  const ratio = contrastRatio(fg, bg);
  return {
    ratio: round2(ratio),
    AA: opts.largeText ? ratio >= 3 : ratio >= 4.5,
    AAA: opts.largeText ? ratio >= 4.5 : ratio >= 7,
    AALarge: ratio >= 3,
    AAALarge: ratio >= 4.5,
  };
}

// ── HSL helpers (for the fix suggester) ──

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  h = ((((h % 360) + 360) % 360) / 360);
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return {
    r: Math.round(hue(h + 1 / 3) * 255),
    g: Math.round(hue(h) * 255),
    b: Math.round(hue(h - 1 / 3) * 255),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => clampByte(n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function toHex(rgb: Rgb): string {
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

/** Invert a color's HSL lightness (hue and saturation preserved). */
export function invertLightness(color: string): string {
  const rgb = parseColor(color);
  if (!rgb) return color;
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const out = hslToRgb(hsl.h, hsl.s, clamp01(1 - hsl.l));
  return toHex(out);
}

function nudgeLightness(
  rgb: Rgb,
  lighter: boolean,
  against: string,
  target: number,
): { hex: string; ratio: number } {
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  let best = { hex: toHex(rgb), ratio: 0 };
  try {
    best.ratio = contrastRatio(best.hex, against);
  } catch {
    /* against is unparseable — handled by caller */
  }
  for (let i = 1; i <= 100; i++) {
    const l = clamp01(hsl.l + (lighter ? 1 : -1) * i * 0.01);
    const hex = toHex(hslToRgb(hsl.h, hsl.s, l));
    let ratio: number;
    try {
      ratio = contrastRatio(hex, against);
    } catch {
      break;
    }
    if (ratio >= target) return { hex, ratio };
    best = { hex, ratio };
    if (l === 0 || l === 1) break;
  }
  return best;
}

/**
 * Suggest a passing color. Nudges the foreground's HSL lightness toward the
 * nearer end (white if the background is darker, black if lighter) in 1% steps
 * until it clears `target` (default AA 4.5). For fill pairs pass
 * `offerBackground: true` to also get a background suggestion.
 */
export function suggestFix(
  fg: string,
  bg: string,
  opts: { target?: number; offerBackground?: boolean } = {},
): ContrastFix | undefined {
  const target = opts.target ?? 4.5;
  const fgRgb = parseColor(fg);
  const bgRgb = parseColor(bg);
  if (!fgRgb || !bgRgb) return undefined;

  let current: number;
  try {
    current = contrastRatio(fg, bg);
  } catch {
    return undefined;
  }

  const lFg = relativeLuminance(fg);
  const lBg = relativeLuminance(bg);
  const goLighter = lBg <= lFg;

  if (current >= target) {
    return {
      movedChannel: 'foreground',
      direction: goLighter ? 'lighter' : 'darker',
      fg: toHex(fgRgb),
      ratio: round2(current),
      note: 'already passes',
    };
  }

  const nudged = nudgeLightness(fgRgb, goLighter, bg, target);
  const fix: ContrastFix = {
    movedChannel: 'foreground',
    direction: goLighter ? 'lighter' : 'darker',
    fg: nudged.hex,
    ratio: round2(nudged.ratio),
  };
  if (nudged.ratio < target) {
    fix.note = `foreground alone reaches only ${round2(nudged.ratio)}:1 — move the background too`;
  }
  if (opts.offerBackground) {
    const bgNudged = nudgeLightness(bgRgb, !goLighter, fg, target);
    fix.bg = bgNudged.hex;
    fix.movedChannel = 'background';
  }
  return fix;
}

// ── Token-set auditing ──

interface PairDef {
  name: string;
  fg: string;
  bg: string;
  role: PairRole;
  fill?: boolean;
}

const TOKEN_PAIRS: PairDef[] = [
  { name: 'foreground/background', fg: 'foreground', bg: 'background', role: 'body' },
  { name: 'muted-foreground/background', fg: 'muted-foreground', bg: 'background', role: 'body' },
  { name: 'muted-foreground/muted', fg: 'muted-foreground', bg: 'muted', role: 'body' },
  { name: 'primary-foreground/primary', fg: 'primary-foreground', bg: 'primary', role: 'body', fill: true },
  { name: 'accent-foreground/accent', fg: 'accent-foreground', bg: 'accent', role: 'body', fill: true },
  { name: 'secondary-foreground/secondary', fg: 'secondary-foreground', bg: 'secondary', role: 'body', fill: true },
  { name: 'foreground/card', fg: 'foreground', bg: 'card', role: 'body' },
  { name: 'card-foreground/card', fg: 'card-foreground', bg: 'card', role: 'body' },
  { name: 'border/background', fg: 'border', bg: 'background', role: 'ui' },
  { name: 'ring/background', fg: 'ring', bg: 'background', role: 'ui' },
];

function thresholdFor(role: PairRole, largeText?: boolean): number {
  if (role === 'ui' || role === 'large') return 3;
  return largeText ? 3 : 4.5;
}

function levelFor(ratio: number): ContrastPairResult['level'] {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA Large';
  return 'fail';
}

/**
 * Audit the meaningful text/surface pairings in a token set. Pairs whose tokens
 * are missing are reported under `skipped`, as are unparseable colors.
 */
export function auditTokenContrast(
  tokens: DesignTokenSet,
  opts: { largeText?: boolean } = {},
): TokenContrastReport {
  const colors: Record<string, string> = tokens?.colors ?? {};
  const pairs: ContrastPairResult[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const def of TOKEN_PAIRS) {
    const fgVal = colors[def.fg];
    const bgVal = colors[def.bg];
    if (!fgVal || !bgVal) {
      // Only report a missing pair when at least one half exists — otherwise the
      // token set simply doesn't use that role.
      if (fgVal || bgVal) {
        skipped.push({ name: def.name, reason: `missing token: ${fgVal ? def.bg : def.fg}` });
      }
      continue;
    }

    let ratio: number;
    try {
      ratio = contrastRatio(fgVal, bgVal);
    } catch (err) {
      skipped.push({ name: def.name, reason: (err as Error).message });
      continue;
    }

    const threshold = thresholdFor(def.role, opts.largeText);
    const passes = ratio >= threshold;
    const result: ContrastPairResult = {
      name: def.name,
      fg: fgVal,
      bg: bgVal,
      ratio: round2(ratio),
      level: levelFor(ratio),
      passes,
      role: def.role,
    };
    if (!passes) {
      const fix = suggestFix(fgVal, bgVal, { target: threshold, offerBackground: def.fill });
      if (fix) result.fix = fix;
    }
    pairs.push(result);
  }

  const failures = pairs.filter((p) => !p.passes);
  const worst = pairs.length ? pairs.reduce((a, b) => (b.ratio < a.ratio ? b : a)) : null;
  return {
    pairs,
    failures,
    worst: worst ? { name: worst.name, ratio: worst.ratio } : null,
    skipped,
  };
}

/**
 * Run {@link auditTokenContrast} on a light and a dark token set and diff them,
 * so a fg/bg combo that passes light but fails dark (or vice versa) is caught.
 */
export function auditThemePair(
  light: DesignTokenSet,
  dark: DesignTokenSet,
  opts: { largeText?: boolean } = {},
): ThemePairReport {
  const l = auditTokenContrast(light, opts);
  const d = auditTokenContrast(dark, opts);

  const darkByName = new Map(d.pairs.map((p) => [p.name, p]));
  const regressions: ThemePairReport['regressions'] = [];
  for (const lp of l.pairs) {
    const dp = darkByName.get(lp.name);
    if (!dp || lp.passes === dp.passes) continue;
    regressions.push({
      name: lp.name,
      lightRatio: lp.ratio,
      darkRatio: dp.ratio,
      failsIn: lp.passes ? 'dark' : 'light',
    });
  }

  const failures = [
    ...l.failures.map((p) => ({ theme: 'light' as const, name: p.name, ratio: p.ratio })),
    ...d.failures.map((p) => ({ theme: 'dark' as const, name: p.name, ratio: p.ratio })),
  ];

  const worstCandidates = [
    l.worst ? { theme: 'light' as const, ...l.worst } : null,
    d.worst ? { theme: 'dark' as const, ...d.worst } : null,
  ].filter((x): x is { theme: 'light' | 'dark'; name: string; ratio: number } => x != null);
  const worst = worstCandidates.length
    ? worstCandidates.reduce((a, b) => (b.ratio < a.ratio ? b : a))
    : null;

  return { light: l, dark: d, regressions, failures, worst };
}

/** Approximate a dark token set by inverting every color's HSL lightness. */
export function synthesizeDarkTokens(tokens: DesignTokenSet): DesignTokenSet {
  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(tokens.colors ?? {})) colors[k] = invertLightness(v);
  return { ...tokens, colors };
}

// ── CSS extraction (best-effort) ──

function isColorHex(v: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(v);
}

function normalizeColor(v: string): string {
  const rgb = parseColor(v.trim());
  return rgb ? toHex(rgb) : v.trim();
}

function firstColorToken(v: string): string | null {
  for (const tok of v.split(/\s+/)) {
    if (parseColor(tok)) return tok;
  }
  return null;
}

function lastDecl(body: string, re: RegExp): string | null {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = re.exec(body))) last = m[1].trim();
  return last;
}

function stem(key: string): string {
  return key
    .replace(/^--/, '')
    .replace(/^color-/, '')
    .replace(/[-_]?(fg|bg|foreground|background|surface|text|ink|base|color|fill|panel)$/i, '')
    .replace(/[-_]$/, '');
}

function shareStem(a: string, b: string): boolean {
  const sa = stem(a);
  return sa.length > 0 && sa === stem(b);
}

/**
 * Pull candidate `{ fg, bg, selector }` pairs from a CSS string. Two heuristics:
 *
 *   1. Within a single rule block, a `color:` declaration paired with a
 *      `background` / `background-color` declaration.
 *   2. Within a single block, custom properties whose names look like a
 *      foreground (`--*-foreground`, `--*-fg`, `--*-text`) matched to a
 *      background sibling by shared stem (`--card-foreground` ↔ `--card`), or
 *      failing that to a plain `--background` / `--surface`.
 *
 * `var(--x)` references are resolved one hop against a flat map of every custom
 * property in the source (last declaration wins).
 *
 * Limits: it does NOT resolve the cascade, specificity, inheritance, `@media` /
 * `[data-theme]` overrides across blocks, shorthand `background` layers beyond
 * the first color token, `hsl()` / `oklch()` / named colors other than
 * white/black, or nested selectors. Treat the output as candidates to classify,
 * not ground truth.
 */
export function extractColorPairsFromCss(css: string): { pairs: CssColorPair[]; notes: string[] } {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');

  const varMap = new Map<string, string>();
  for (const m of clean.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) varMap.set(m[1].trim(), m[2].trim());

  const resolve = (val: string): string => {
    let v = val.trim();
    for (let i = 0; i < 4 && v.toLowerCase().startsWith('var('); i++) {
      const m = v.match(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]+))?\)/i);
      if (!m) break;
      v = (varMap.get(m[1]) ?? m[2] ?? '').trim();
    }
    return v;
  };

  const pairs: CssColorPair[] = [];

  for (const block of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = block[1].trim().replace(/\s+/g, ' ').slice(0, 120) || ':root';
    const body = block[2];

    // Heuristic 1: same-rule color + background.
    const cRaw = lastDecl(body, /(?:^|[;{]|\s)color\s*:\s*([^;}]+)/gi);
    const bgRaw = lastDecl(body, /background(?:-color)?\s*:\s*([^;}]+)/gi);
    if (cRaw && bgRaw) {
      const fg = normalizeColor(resolve(cRaw));
      const bgResolved = resolve(bgRaw);
      const bg = normalizeColor(firstColorToken(bgResolved) ?? bgResolved);
      if (isColorHex(fg) && isColorHex(bg) && fg !== bg) {
        pairs.push({ selector, fg, bg, source: 'rule' });
      }
    }

    // Heuristic 2: custom-property fg/bg siblings.
    const local = new Map<string, string>();
    for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) local.set(m[1].trim(), m[2].trim());
    if (local.size) {
      const keys = [...local.keys()];
      const fgKeys = keys.filter((k) => /(fg|foreground|text|ink)/i.test(k));
      const bgKeys = keys.filter((k) =>
        /(bg|background|surface|card|base|muted|panel|fill|primary|secondary|accent|destructive|ring|input|popover)/i.test(k),
      );
      for (const fk of fgKeys) {
        const fv = normalizeColor(resolve(local.get(fk)!));
        if (!isColorHex(fv)) continue;
        const bk =
          bgKeys.find((b) => shareStem(b, fk)) ??
          bgKeys.find((b) => /^--(color-)?(bg|background|surface|base)$/i.test(b)) ??
          bgKeys[0];
        if (!bk) continue;
        const bv = normalizeColor(resolve(local.get(bk)!));
        if (!isColorHex(bv) || bv === fv) continue;
        pairs.push({ selector: `${selector} (${fk})`, fg: fv, bg: bv, source: 'custom-property' });
      }
    }
  }

  const seen = new Set<string>();
  const deduped = pairs.filter((p) => {
    const key = `${p.selector}|${p.fg}|${p.bg}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const notes = [
    'Heuristic pairing only: colors are matched within a single rule/custom-property block. ' +
      'Cascade, specificity, inheritance and cross-block @media/theme overrides are not resolved — verify against real usage.',
  ];
  if (!deduped.length) {
    notes.push('No color/background pairs found in the source.');
  }
  return { pairs: deduped, notes };
}
