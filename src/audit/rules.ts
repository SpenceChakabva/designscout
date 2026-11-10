/**
 * DesignScout anti-pattern registry.
 *
 * Deterministic rules for catching AI-generated design and copy tells.
 * Adapted from impeccable's approach: no LLM needed, pure pattern matching.
 *
 * Three categories:
 *   - 'slop'    → AI-generated UI tells (design patterns every model defaults to)
 *   - 'copy'    → AI-generated copy tells (punctuation, phrasing, word choice)
 *   - 'quality' → General design quality issues
 */

// ── Overused fonts (same list as impeccable) ──
export const OVERUSED_FONTS = new Set([
  'inter', 'roboto', 'open sans', 'lato', 'montserrat', 'arial', 'helvetica',
  'fraunces', 'instrument sans', 'instrument serif',
  'geist', 'geist sans', 'geist mono', 'mona sans',
  'plus jakarta sans', 'space grotesk', 'recoleta',
]);

// ── Tailwind default blues that scream "I didn't pick a color" ──
const TAILWIND_DEFAULT_BLUES = new Set([
  '3b82f6', '2563eb', '1d4ed8', '60a5fa', '93c5fd', // blue-400 through blue-700
  '6366f1', '4f46e5', '4338ca', '818cf8',            // indigo-400 through indigo-700
  '8b5cf6', '7c3aed', '6d28d9', 'a78bfa',            // violet-400 through violet-700
]);

// ── AI copy phrases ──
export const AI_COPY_PHRASES = [
  'elevate', 'leverage', 'streamline', 'supercharge', 'unlock',
  'empower', 'reimagine', 'revolutionize', 'harness the power',
  'take .+ to the next level', 'dive into', 'delve into',
  'effortlessly', 'seamlessly', 'it\'s that simple',
  'in today\'s .+ world', 'in an era of', 'whether you\'re a .+ or a',
  'imagine a world where', 'say goodbye to', 'say hello to',
  'tired of', 'looking for a way to',
  'robust', 'cutting-edge', 'game-changer', 'game changing',
  'best-in-class', 'world-class', 'state-of-the-art',
  'comprehensive solution', 'powerful yet simple',
  'intuitive interface', 'user-friendly',
  'join .+ who have already', 'what are you waiting for',
  'get started today', 'start your journey',
  'the future of .+ is here', 'ready to .+ \\?',
];

// ── AI punctuation rules ──
export const AI_PUNCTUATION_RULES = [
  {
    id: 'em-dash-overuse',
    pattern: /—/g,
    threshold: 6,
    densityPer: 400,
    description: 'Heavy em-dash usage is the strongest punctuation tell of AI-generated copy. Rewrite as separate sentences or use commas.',
  },
  {
    id: 'exclamation-density',
    pattern: /!/g,
    threshold: 4,
    densityPer: 300,
    description: 'Excessive exclamation marks read as forced enthusiasm. Reserve for genuine emphasis.',
  },
  {
    id: 'ellipsis-overuse',
    pattern: /\.{3}|…/g,
    threshold: 3,
    densityPer: 500,
    description: 'Trailing ellipses are an AI crutch for false drama. End sentences decisively.',
  },
  {
    id: 'colon-header-pattern',
    pattern: /^[A-Z][^.!?\n]{2,30}:\s/gm,
    threshold: 4,
    densityPer: 200,
    description: '"Label: Description" formatting is a structural AI tell. Use hierarchy (headings, size, weight) instead.',
  },
];

// ── Types ──

export interface AntiPatternRule {
  id: string;
  category: 'slop' | 'copy' | 'quality';
  name: string;
  description: string;
  check: (input: CheckInput) => Finding[];
}

export interface CheckInput {
  html?: string;
  css?: string;
  text?: string;
  colors?: string[];
  fonts?: string[];
  backgroundColors?: string[];
  /** Colours known to be used as text. Contrast checks use these when present. */
  textColors?: string[];
}

export interface Finding {
  ruleId: string;
  category: 'slop' | 'copy' | 'quality';
  name: string;
  severity: 'error' | 'warning' | 'advisory';
  description: string;
  snippet?: string;
  fix?: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// COLOR UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace('#', '');
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const toLinear = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function isPureGray(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  return Math.abs(rgb.r - rgb.g) <= 3 && Math.abs(rgb.g - rgb.b) <= 3
    && rgb.r > 20 && rgb.r < 240;
}

function isPureBlack(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  return rgb.r <= 5 && rgb.g <= 5 && rgb.b <= 5;
}

function isPureWhite(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  return rgb.r >= 252 && rgb.g >= 252 && rgb.b >= 252;
}

function isCreamColor(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  return rgb.r > 230 && rgb.g > 220 && rgb.b > 190 && rgb.b < 235
    && (rgb.r - rgb.b) > 15 && (rgb.g - rgb.b) > 10;
}

function isPurple(hex: string): boolean {
  const hsl = hexToHsl(hex);
  if (!hsl) return false;
  return hsl.h >= 250 && hsl.h <= 310 && hsl.s > 0.25 && hsl.l > 0.15 && hsl.l < 0.85;
}

function isCyanTeal(hex: string): boolean {
  const hsl = hexToHsl(hex);
  if (!hsl) return false;
  return hsl.h >= 160 && hsl.h <= 210 && hsl.s > 0.4 && hsl.l > 0.3;
}

function isTailwindDefault(hex: string): boolean {
  return TAILWIND_DEFAULT_BLUES.has(hex.replace('#', '').toLowerCase());
}

function isDarkBackground(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  return (rgb.r + rgb.g + rgb.b) / 3 < 50;
}

// ══════════════════════════════════════════════════════════════════════════════
// DESIGN SLOP CHECKS
// ══════════════════════════════════════════════════════════════════════════════

function checkOverusedFonts(input: CheckInput): Finding[] {
  if (!input.fonts?.length) return [];
  const findings: Finding[] = [];
  for (const font of input.fonts) {
    if (OVERUSED_FONTS.has(font.toLowerCase().trim())) {
      findings.push({
        ruleId: 'overused-font',
        category: 'slop',
        name: 'Overused font',
        severity: 'warning',
        description: `"${font}" is on the AI monoculture list. Every model defaults to it.`,
        snippet: font,
        fix: 'DM Sans, Satoshi, General Sans, Cabinet Grotesk, Switzer, or Manrope are clean alternatives.',
      });
    }
  }
  return findings;
}

function checkPureGrays(input: CheckInput): Finding[] {
  if (!input.colors?.length) return [];
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const color of input.colors) {
    const hex = color.startsWith('#') ? color : `#${color}`;
    if (seen.has(hex)) continue;
    seen.add(hex);
    if (isPureGray(hex)) {
      findings.push({
        ruleId: 'pure-gray',
        category: 'quality',
        name: 'Pure neutral gray',
        severity: 'warning',
        description: `${hex} is a pure gray with no hue. Untinted grays read as default, not designed.`,
        snippet: hex,
        fix: 'Shift RGB channels 5-15 points toward the primary hue. Even a subtle tint reads as intentional.',
      });
    }
  }
  return findings;
}

function checkPureBlackWhite(input: CheckInput): Finding[] {
  if (!input.colors?.length) return [];
  const findings: Finding[] = [];
  for (const color of input.colors) {
    const hex = color.startsWith('#') ? color : `#${color}`;
    if (isPureBlack(hex)) {
      findings.push({
        ruleId: 'pure-black',
        category: 'quality',
        name: 'Pure black',
        severity: 'advisory',
        description: `${hex} is pure black. Tint it toward the brand hue for warmth (e.g. #0C1A16 instead of #000000).`,
        snippet: hex,
        fix: 'Use a dark tint of your primary color. Pure black is harsh and reads as undesigned.',
      });
    }
    if (isPureWhite(hex) && input.backgroundColors?.some(bg => bg === color)) {
      // Pure white as background is fine in many contexts, only flag if it's the only bg
      // Skip this — pure white backgrounds are legitimate
    }
  }
  return findings;
}

function checkCreamPalette(input: CheckInput): Finding[] {
  if (!input.backgroundColors?.length) return [];
  const findings: Finding[] = [];
  for (const color of input.backgroundColors) {
    const hex = color.startsWith('#') ? color : `#${color}`;
    if (isCreamColor(hex)) {
      findings.push({
        ruleId: 'cream-palette',
        category: 'slop',
        name: 'Cream / beige surface',
        severity: 'warning',
        description: `${hex} is the default "tasteful" AI warm surface. It's reached for by reflex, not by choice.`,
        snippet: hex,
        fix: 'Push the hue further toward the brand, or pick a tinted near-white or a bold surface color.',
      });
    }
  }
  return findings;
}

function checkAIPalette(input: CheckInput): Finding[] {
  if (!input.colors?.length) return [];
  const findings: Finding[] = [];
  let purpleCount = 0;
  let cyanOnDark = false;
  let tailwindDefaults = 0;

  for (const color of input.colors) {
    const hex = color.startsWith('#') ? color : `#${color}`;
    if (isPurple(hex)) purpleCount++;
    if (isTailwindDefault(hex)) tailwindDefaults++;
  }

  // Check cyan-on-dark combination
  const hasdarks = input.backgroundColors?.some(c => isDarkBackground(c.startsWith('#') ? c : `#${c}`));
  const hasCyan = input.colors.some(c => isCyanTeal(c.startsWith('#') ? c : `#${c}`));
  if (hasdarks && hasCyan) cyanOnDark = true;

  if (purpleCount >= 2) {
    findings.push({
      ruleId: 'ai-purple-palette',
      category: 'slop',
      name: 'Purple / violet palette',
      severity: 'warning',
      description: 'Multiple purple/violet colors are the most recognizable AI palette tell. Every model reaches for purple first.',
      fix: 'Choose a distinctive palette grounded in the brand or subject. If purple is intentional, commit to it as a brand decision, not a default.',
    });
  }

  if (cyanOnDark) {
    findings.push({
      ruleId: 'ai-cyan-on-dark',
      category: 'slop',
      name: 'Cyan / teal on dark background',
      severity: 'advisory',
      description: 'Bright cyan or teal on a dark background is the second most common AI color combination after purple.',
      fix: 'If the palette is intentional, keep it. If you reached for it because it "looks techy," that is the tell.',
    });
  }

  if (tailwindDefaults >= 3) {
    findings.push({
      ruleId: 'tailwind-default-palette',
      category: 'slop',
      name: 'Tailwind default colors',
      severity: 'advisory',
      description: `${tailwindDefaults} colors match Tailwind's default blue/indigo/violet palette. Using the framework defaults as your brand palette reads as "I didn't pick colors."`,
      fix: 'Define a custom palette. Even shifting the hue 10-20 degrees distinguishes the site from every other Tailwind project.',
    });
  }

  return findings;
}

function checkGradientText(input: CheckInput): Finding[] {
  if (!input.css && !input.html) return [];
  const findings: Finding[] = [];
  const source = (input.css || '') + (input.html || '');

  // background-clip: text with a gradient
  if (/background-clip\s*:\s*text/i.test(source) && /linear-gradient|radial-gradient/i.test(source)) {
    findings.push({
      ruleId: 'gradient-text',
      category: 'slop',
      name: 'Gradient text',
      severity: 'warning',
      description: 'Gradient text (background-clip: text) is decorative rather than meaningful — a top AI tell, especially on headings.',
      fix: 'Use solid colors for text. Emphasis comes from weight, size, or color — not shimmer.',
    });
  }

  // Tailwind bg-clip-text + bg-gradient-to-*
  if (/bg-clip-text/i.test(source) && /bg-gradient-to/i.test(source)) {
    findings.push({
      ruleId: 'gradient-text',
      category: 'slop',
      name: 'Gradient text (Tailwind)',
      severity: 'warning',
      description: 'bg-clip-text with bg-gradient is the Tailwind version of gradient text — same AI tell.',
      fix: 'Use a solid text color.',
    });
  }

  return findings;
}

function checkDarkGlow(input: CheckInput): Finding[] {
  if (!input.css && !input.html) return [];
  const findings: Finding[] = [];
  const source = (input.css || '') + (input.html || '');

  // Colored glow shadows: box-shadow with 0 offset and chromatic color
  const glowPattern = /box-shadow\s*:[^;]*\b0(?:px)?\s+0(?:px)?\s+\d+(?:px)?\s+(?:\d+(?:px)?\s+)?(?!rgba?\(\s*(?:0|255)\s*,\s*(?:0|255)\s*,\s*(?:0|255))(?:rgba?\([^)]+\)|#[0-9a-f]{3,8})/gi;
  if (glowPattern.test(source)) {
    findings.push({
      ruleId: 'dark-glow',
      category: 'slop',
      name: 'Colored glow shadow',
      severity: 'warning',
      description: 'Zero-offset chromatic box-shadow halos are the default "cool" AI look. Use neutral elevation shadows instead.',
      fix: 'Add an offset and use neutral colors for depth. Glow is decoration pretending to be elevation.',
    });
  }

  // Tailwind shadow-[color] patterns that produce glows
  if (/shadow-(?:purple|blue|indigo|violet|cyan|teal|emerald|green|pink|rose)-\d{3}/i.test(source)) {
    findings.push({
      ruleId: 'dark-glow',
      category: 'slop',
      name: 'Colored shadow utility',
      severity: 'advisory',
      description: 'Tailwind colored shadow utilities produce the same glow effect. The color in the shadow should come from a deliberate decision.',
    });
  }

  return findings;
}

function checkRadialHalo(input: CheckInput): Finding[] {
  if (!input.css && !input.html) return [];
  const source = (input.css || '') + (input.html || '');
  const findings: Finding[] = [];

  // Chromatic radial-gradient used as a background wash/spotlight
  const haloPattern = /radial-gradient\s*\(\s*(?:circle|ellipse)?[^,]*,\s*(?!(?:rgba?\(\s*(?:0|255)\s*,\s*(?:0|255)\s*,\s*(?:0|255)))[^,]+,\s*transparent\s*\)/gi;
  if (haloPattern.test(source)) {
    findings.push({
      ruleId: 'radial-halo',
      category: 'slop',
      name: 'Radial gradient halo',
      severity: 'warning',
      description: 'A chromatic radial-gradient fading to transparent is a decorative AI background glow. Let the surface stand on its own.',
      fix: 'Use a solid or subtly shifted background. If you need atmosphere, use a deliberate material accent, not a floating haze.',
    });
  }

  return findings;
}

function checkSideTabBorder(input: CheckInput): Finding[] {
  if (!input.css && !input.html) return [];
  const source = (input.css || '') + (input.html || '');
  const findings: Finding[] = [];

  // Thick single-side border (the #1 AI card tell)
  const sideTab = /border-(?:left|right)\s*:\s*(?:[3-9]|1\d)px\s+solid\s+(?!(?:transparent|inherit|currentColor|#(?:0{6}|f{6})))/gi;
  if (sideTab.test(source)) {
    findings.push({
      ruleId: 'side-tab',
      category: 'slop',
      name: 'Side-tab accent border',
      severity: 'warning',
      description: 'A thick colored border on one side of a card is the most recognizable AI-generated UI tell.',
      fix: 'Use a subtler accent (a top/bottom hairline, a background tint, or remove it entirely).',
    });
  }

  // Tailwind single-side border
  if (/\bborder-[lr]-(?:[248]|[1-9]\d)\b/i.test(source) && /\bborder-(?:purple|blue|indigo|violet|cyan|teal|emerald|green|pink|rose|amber|orange|red)-\d{3}\b/i.test(source)) {
    findings.push({
      ruleId: 'side-tab',
      category: 'slop',
      name: 'Side-tab border (Tailwind)',
      severity: 'warning',
      description: 'border-l/r with a colored border class is the Tailwind side-tab tell.',
      fix: 'Remove the single-side colored border.',
    });
  }

  return findings;
}

function checkBounceEasing(input: CheckInput): Finding[] {
  if (!input.css && !input.html) return [];
  const source = (input.css || '') + (input.html || '');
  const findings: Finding[] = [];

  if (/(?:bounce|elastic|spring)/i.test(source) && /(?:animation|transition|ease)/i.test(source)) {
    findings.push({
      ruleId: 'bounce-easing',
      category: 'slop',
      name: 'Bounce / elastic easing',
      severity: 'warning',
      description: 'Bounce and elastic easing feel dated. Real objects decelerate smoothly.',
      fix: 'Use exponential ease-out (ease-out-quart, cubic-bezier(.22,1,.36,1)). Smooth deceleration reads as quality.',
    });
  }

  return findings;
}

function checkGrayOnColor(input: CheckInput): Finding[] {
  if (!input.colors?.length || !input.backgroundColors?.length) return [];
  const findings: Finding[] = [];

  for (const bg of input.backgroundColors) {
    const bgHex = bg.startsWith('#') ? bg : `#${bg}`;
    const bgHsl = hexToHsl(bgHex);
    // Only check colored backgrounds (not near-white, not near-black, has saturation)
    if (!bgHsl || bgHsl.s < 0.15 || bgHsl.l < 0.1 || bgHsl.l > 0.9) continue;

    for (const fg of input.colors) {
      const fgHex = fg.startsWith('#') ? fg : `#${fg}`;
      if (isPureGray(fgHex)) {
        findings.push({
          ruleId: 'gray-on-color',
          category: 'quality',
          name: 'Gray text on colored background',
          severity: 'warning',
          description: `Pure gray ${fgHex} on colored background ${bgHex}. On colored surfaces, tint text from that hue or the foreground — never use untinted gray.`,
          snippet: `${fgHex} on ${bgHex}`,
          fix: 'Tint the text color toward the background hue, or use the ink color from your palette.',
        });
      }
    }
  }
  return findings;
}

function checkGlassmorphism(input: CheckInput): Finding[] {
  const source = (input.css || '') + (input.html || '');
  if (!source) return [];
  const findings: Finding[] = [];
  const blur = /backdrop-filter\s*:\s*[^;]*blur|backdrop-blur|-webkit-backdrop-filter/i.test(source);
  const translucent = /rgba?\([^)]+,\s*0?\.[0-5]\d*\s*\)|\/\s*[0-5]?\d%\s*\)|bg-white\/\d{1,2}\b|bg-black\/\d{1,2}\b/i.test(source);
  if (blur && translucent) {
    findings.push({
      ruleId: 'glassmorphism',
      category: 'slop',
      name: 'Glassmorphism',
      severity: 'warning',
      description: 'Frosted-glass panels (backdrop-blur over a translucent fill) are a default "modern" AI look. They rarely survive contact with real content behind them.',
      fix: 'Use an opaque surface with a real elevation shadow, or commit to the effect as a deliberate brand choice.',
    });
  }
  return findings;
}

function checkFullViewportSections(input: CheckInput): Finding[] {
  const source = (input.css || '') + (input.html || '');
  if (!source) return [];
  const matches = source.match(/(?:min-)?height\s*:\s*100(?:d|s|l)?vh|\bh-screen\b|\bmin-h-screen\b/gi) || [];
  if (matches.length >= 3) {
    return [{
      ruleId: 'full-viewport-sections',
      category: 'slop',
      name: 'Stacked 100vh sections',
      severity: 'advisory',
      description: `${matches.length} full-viewport-height sections. Forcing every section to fill the screen is an AI layout reflex — it wastes space and fights the content.`,
      snippet: `${matches.length} occurrences`,
      fix: 'Size sections to their content with generous but finite padding.',
    }];
  }
  return [];
}

function checkUniformRadius(input: CheckInput): Finding[] {
  const source = (input.css || '') + (input.html || '');
  if (!source) return [];
  const tw = source.match(/\brounded-(?:xl|2xl|3xl)\b/g) || [];
  if (tw.length >= 12) {
    return [{
      ruleId: 'uniform-radius',
      category: 'slop',
      name: 'Everything rounded-xl',
      severity: 'advisory',
      description: `rounded-xl/2xl appears ${tw.length} times. A single large radius on every surface — cards, buttons, inputs, images, avatars — is a recognizable AI default.`,
      snippet: `${tw.length} occurrences`,
      fix: 'Use a small radius scale (e.g. 4px controls, 8px cards) and let some elements be square.',
    }];
  }
  return [];
}

function checkEmojiHeadings(input: CheckInput): Finding[] {
  if (!input.html) return [];
  const findings: Finding[] = [];
  const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;
  const headings = input.html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi) || [];
  const withEmoji = headings.filter(h => emoji.test(h.replace(/<[^>]+>/g, '')));
  if (withEmoji.length >= 2) {
    findings.push({
      ruleId: 'emoji-headings',
      category: 'slop',
      name: 'Emoji in headings',
      severity: 'warning',
      description: `${withEmoji.length} headings contain emoji. Emoji as section-heading decoration is a strong AI tell.`,
      snippet: withEmoji[0].replace(/<[^>]+>/g, '').trim().slice(0, 60),
      fix: 'Remove the emoji. If you need a visual marker, use a deliberate icon system consistently.',
    });
  }
  return findings;
}

function checkIconTileHeading(input: CheckInput): Finding[] {
  if (!input.html) return [];
  // <div class="...icon...">... <svg> ...</div> ... <h2/h3>
  const pattern = /<div[^>]*class="[^"]*(?:icon|feature)[^"]*"[^>]*>\s*<svg[\s\S]{0,400}?<\/svg>\s*<\/div>\s*(?:<[^>]+>\s*){0,2}<h[2-4]/gi;
  const matches = input.html.match(pattern) || [];
  if (matches.length >= 3) {
    return [{
      ruleId: 'icon-tile-heading',
      category: 'slop',
      name: 'Icon tile above every heading',
      severity: 'warning',
      description: `${matches.length} sections lead with a small icon in a rounded tile directly above the heading. This is the single most recognizable AI feature-section layout.`,
      snippet: `${matches.length} occurrences`,
      fix: 'Drop the icon tiles, or use them sparingly where they add real meaning. Let the headings carry the hierarchy.',
    }];
  }
  return [];
}

function checkStaggerReveal(input: CheckInput): Finding[] {
  const source = (input.css || '') + (input.html || '');
  if (!source) return [];
  const delays = source.match(/(?:animation-delay|transition-delay)\s*:\s*[0-9.]+m?s|\bdelay-\[?\d+/gi) || [];
  const aos = /data-aos|data-aos-delay/i.test(source);
  if (delays.length >= 5 || aos) {
    return [{
      ruleId: 'stagger-reveal',
      category: 'slop',
      name: 'Staggered scroll-reveal',
      severity: 'advisory',
      description: 'Incrementing animation-delay values (or AOS data attributes) staggering elements in on scroll is a default AI motion pattern.',
      fix: 'Reveal content in one clean motion, or don\'t animate it in at all. Reserve motion for state changes.',
    }];
  }
  return [];
}

// ══════════════════════════════════════════════════════════════════════════════
// COPY / PUNCTUATION CHECKS
// ══════════════════════════════════════════════════════════════════════════════

function checkAICopyPhrases(input: CheckInput): Finding[] {
  if (!input.text) return [];
  const findings: Finding[] = [];
  for (const phrase of AI_COPY_PHRASES) {
    const re = new RegExp(phrase, 'gi');
    const match = re.exec(input.text);
    if (match) {
      findings.push({
        ruleId: 'ai-copy-phrase',
        category: 'copy',
        name: 'AI copy tell',
        severity: 'warning',
        description: `"${match[0]}" is a recurring AI-generated copy pattern.`,
        snippet: match[0],
        fix: 'Rewrite in the product\'s own voice. Say what it does, plainly.',
      });
    }
  }
  return findings;
}

function checkAIPunctuation(input: CheckInput): Finding[] {
  if (!input.text) return [];
  const findings: Finding[] = [];
  const text = input.text;

  for (const rule of AI_PUNCTUATION_RULES) {
    const matches = text.match(rule.pattern);
    const count = matches?.length || 0;
    if (count < rule.threshold) continue;
    if (text.length > count * rule.densityPer) continue;
    findings.push({
      ruleId: rule.id,
      category: 'copy',
      name: rule.id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      severity: 'warning',
      description: rule.description,
      snippet: `${count} instances in ${text.length} characters`,
    });
  }

  // Trailing arrows on CTAs
  const arrowCtas = (text.match(/→|->|>>|»/g) || []).length;
  if (arrowCtas >= 3) {
    findings.push({
      ruleId: 'trailing-arrow-overuse',
      category: 'copy',
      name: 'Trailing arrow overuse',
      severity: 'advisory',
      description: 'Trailing arrows on every CTA is an AI pattern. Use on navigational/secondary actions only.',
      snippet: `${arrowCtas} trailing arrows`,
    });
  }

  // Fake metrics pattern
  const fakeMetrics = text.match(/\b\d{2,}\+\b/g);
  if (fakeMetrics && fakeMetrics.length >= 3) {
    findings.push({
      ruleId: 'fake-metrics',
      category: 'copy',
      name: 'Template metric pattern',
      severity: 'advisory',
      description: 'Multiple "N+" metrics in one section is the AI hero-metric template.',
      snippet: fakeMetrics.join(', '),
      fix: 'Use specific, verifiable numbers or remove them.',
    });
  }

  return findings;
}

function checkGenericTestimonials(input: CheckInput): Finding[] {
  if (!input.text) return [];
  const phrases = [
    'game changer', 'game-changer', 'changed the way we', 'best decision we',
    'can\'t imagine going back', 'couldn\'t be happier', 'exceeded our expectations',
    'highly recommend', 'a must-have', 'life-?saver', 'worth every penny',
  ];
  const hits = phrases.filter(p => new RegExp(p, 'i').test(input.text!));
  if (hits.length >= 2) {
    return [{
      ruleId: 'generic-testimonials',
      category: 'copy',
      name: 'Template testimonial language',
      severity: 'advisory',
      description: `Testimonial copy uses generic praise phrases (${hits.slice(0, 3).join(', ')}). Real quotes are specific about what changed and by how much.`,
      snippet: hits.join(', '),
      fix: 'Use verbatim quotes with a name, role, and a concrete outcome — or cut the section.',
    }];
  }
  return [];
}

// ══════════════════════════════════════════════════════════════════════════════
// CRAFT CHECKLIST CHECKS
// Badges, labels, tokens, hierarchy, and feedback — the stuff a page keeps even
// after it stops looking AI-made. Still deterministic pattern matching, same as
// everything above: no rendering, no LLM judgment call.
// ══════════════════════════════════════════════════════════════════════════════

function checkFillerBadge(input: CheckInput): Finding[] {
  if (!input.html) return [];
  // A small pill/badge sitting directly above the <h1> almost always just
  // restates the title or tagline that's already on the page.
  const pattern = /<(?:span|div)[^>]*class="[^"]*\bbadge\b[^"]*"[^>]*>[\s\S]{0,200}?<\/(?:span|div)>\s*(?:<[^>]+>\s*){0,1}<h1\b/i;
  if (pattern.test(input.html)) {
    return [{
      ruleId: 'filler-badge',
      category: 'slop',
      name: 'Filler badge above the headline',
      severity: 'advisory',
      description: 'A decorative pill/badge sits directly above the <h1>. It almost always just restates the title or tagline that is already on the page.',
      fix: 'Delete it, or fold whatever it says into the headline or lead paragraph instead of a separate decorative element.',
    }];
  }
  return [];
}

function checkRedundantEyebrow(input: CheckInput): Finding[] {
  if (!input.html) return [];
  // An uppercase "eyebrow"/"kicker" label immediately before a heading. The
  // heading already carries the section's identity — the label adds nothing.
  const pattern = /<(?:span|p|div)[^>]*class="[^"]*\b(?:eyebrow|kicker)\b[^"]*"[^>]*>[\s\S]{0,60}?<\/(?:span|p|div)>\s*(?:<[^>]+>\s*){0,1}<h[1-4]\b/gi;
  const matches = input.html.match(pattern) || [];
  if (matches.length >= 2) {
    return [{
      ruleId: 'redundant-eyebrow',
      category: 'slop',
      name: 'Redundant eyebrow label',
      severity: 'advisory',
      description: `${matches.length} sections lead with a small uppercase label directly above the heading. The heading already carries the section's identity — the label is a crutch, not information.`,
      snippet: `${matches.length} occurrences`,
      fix: 'Delete the label and let the heading say what the section is about.',
    }];
  }
  return [];
}

function checkRandomItalics(input: CheckInput): Finding[] {
  if (!input.html) return [];
  // <em> around one to three ordinary words, outside a quoted/cited block —
  // decorative emphasis with no reason to single that word out.
  const withoutQuotes = input.html.replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '');
  const match = withoutQuotes.match(/<em>\s*([a-zA-Z][\w'-]*(?:\s+[a-zA-Z][\w'-]*){0,2})\s*<\/em>/);
  if (match) {
    return [{
      ruleId: 'random-italic',
      category: 'copy',
      name: 'Italic emphasis on an ordinary word',
      severity: 'advisory',
      description: `<em>${match[1]}</em> italicizes an ordinary word with no particular reason to stand out. Emphasis should mean something, not decorate.`,
      snippet: match[1],
      fix: 'Remove the <em>, or make the point with word choice instead of styling.',
    }];
  }
  return [];
}

function checkMonospaceCostume(input: CheckInput): Finding[] {
  const css = input.css || '';
  if (!css) return [];
  const codeKeyword = /code|mono|terminal|cli|kbd|pre\b|command|shell|prompt/i;
  const ruleRe = /([^{}]+)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  let costumeCount = 0;
  let sample = '';
  while ((m = ruleRe.exec(css))) {
    const [, selector, body] = m;
    if (!/font-family\s*:[^;]*mono/i.test(body)) continue;
    if (codeKeyword.test(selector)) continue;
    costumeCount++;
    if (!sample) sample = selector.trim().split(',')[0];
  }
  if (costumeCount >= 2) {
    return [{
      ruleId: 'monospace-costume',
      category: 'slop',
      name: 'Monospace as a "technical" costume',
      severity: 'advisory',
      description: `${costumeCount} selectors apply a monospace font to elements that aren't code, data, or a terminal (e.g. "${sample}"). Monospace signals "this is literal text" — using it for ordinary labels is a costume, not a reason.`,
      snippet: sample,
      fix: 'Reserve monospace for code, commands, and tabular data. Use the body typeface with letter-spacing and case for labels.',
    }];
  }
  return [];
}

function checkNoDesignTokens(input: CheckInput): Finding[] {
  const css = input.css || '';
  if (!css) return [];
  const hexCount = new Set(css.match(/#[0-9a-fA-F]{3,8}\b/g) || []).size;
  const tokenCount = (css.match(/var\(--/g) || []).length;
  if (hexCount >= 6 && tokenCount === 0) {
    return [{
      ruleId: 'no-design-tokens',
      category: 'quality',
      name: 'No design tokens',
      severity: 'advisory',
      description: `${hexCount} distinct hex colors are hardcoded directly in rules, with zero custom properties (var(--...)). Without tokens, "the brand green" is just a string repeated everywhere it's used.`,
      fix: 'Promote the repeated colors (and spacing, radius, shadow values) to CSS custom properties on :root and reference them with var().',
    }];
  }
  return [];
}

function checkHeroNoProductVisual(input: CheckInput): Finding[] {
  if (!input.html) return [];
  // Only meaningful on an assembled page with other sections around the hero —
  // a single scaffolded component dropped into its own HTML file (what
  // scout_codegen outputs one-at-a-time) has no asset to embed on its own and
  // isn't the thing this check is for.
  const isFullDoc = /<body[\s>]/i.test(input.html) || /<!doctype\s+html/i.test(input.html);
  if (!isFullDoc) return [];
  const landmarks = (input.html.match(/<(?:header|footer|section|nav)\b/gi) || []).length;
  if (landmarks < 2) return [];
  const bodyMatch = input.html.match(/<body[^>]*>([\s\S]*)/i);
  const body = bodyMatch ? bodyMatch[1] : input.html;
  const heroIdx = body.search(/class="[^"]*\bhero\b[^"]*"/i);
  if (heroIdx < 0) return [];
  const region = body.slice(heroIdx, heroIdx + 3000);
  const hasVisual = /<(?:img|video|canvas|iframe)\b|class="[^"]*(?:terminal|screenshot|preview|demo)[^"]*"/i.test(region);
  if (!hasVisual) {
    return [{
      ruleId: 'hero-no-product-visual',
      category: 'quality',
      name: 'Hero has no product visual',
      severity: 'advisory',
      description: 'The hero section has no image, video, screenshot, or demo — just text and buttons. Visitors have nothing to look at that proves what the product actually is.',
      fix: 'Show the real product: a screenshot, a short demo, a live embed, or an interactive preview — not an illustration of the idea.',
    }];
  }
  return [];
}

function checkGenericHeadline(input: CheckInput): Finding[] {
  if (!input.html) return [];
  const headings = input.html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi) || [];
  // "N things/ways/reasons" followed by a vague pronoun resolution ("it does",
  // "you need") is the tell — followed by a concrete noun ("ways to export")
  // is just an accurate description and must not match.
  const genericPattern = /\b(?:\d+|\w+)\s+(?:things?|ways?|reasons?|features?|steps?)\b.{0,20}\b(?:it does|it offers|you need|you get|that matter|worth knowing)\b/i;
  const vaguePattern = /^(?:everything you need|all you need|the future of|what it does|built for everyone|powerful features|built to last)\b/i;
  for (const h of headings) {
    const text = h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (genericPattern.test(text) || vaguePattern.test(text)) {
      return [{
        ruleId: 'generic-headline',
        category: 'copy',
        name: 'Generic listicle headline',
        severity: 'advisory',
        description: `"${text}" is a template headline shape ("N things it does", "everything you need") that says nothing specific about this product.`,
        snippet: text,
        fix: 'Name the actual capabilities or outcome instead of counting them.',
      }];
    }
  }
  return [];
}

function checkUnemphasizedCta(input: CheckInput): Finding[] {
  if (!input.html) return [];
  const buttons = input.html.match(/<(?:a|button)\b[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*>/gi) || [];
  if (buttons.length < 2) return [];
  const variantPattern = /\bbtn--?(?:primary|cta|accent|main)\b/i;
  const emphasized = buttons.filter(b => variantPattern.test(b));
  if (emphasized.length === 0) {
    return [{
      ruleId: 'unemphasized-cta',
      category: 'quality',
      name: 'No emphasized primary action',
      severity: 'advisory',
      description: `${buttons.length} buttons share the same visual weight with no primary/accent variant among them. When every action looks equally important, none of them does.`,
      fix: 'Give exactly one action per view a primary style (solid fill, brand color) and make the rest secondary.',
    }];
  }
  return [];
}

function checkNoAccentColor(input: CheckInput): Finding[] {
  if (!input.colors || input.colors.length < 3) return [];
  const sats = input.colors
    .map(c => hexToHsl(c.startsWith('#') ? c : `#${c}`))
    .filter((h): h is { h: number; s: number; l: number } => !!h);
  if (!sats.length) return [];
  const hasAccent = sats.some(hsl => hsl.s > 0.25 && hsl.l > 0.15 && hsl.l < 0.9);
  if (!hasAccent) {
    return [{
      ruleId: 'no-accent-color',
      category: 'quality',
      name: 'No accent color',
      severity: 'advisory',
      description: 'Every color in the palette is neutral (low saturation). Nothing reads as a deliberate brand color for links, CTAs, or active states.',
      fix: 'Pick one saturated accent color and reserve it for actions and emphasis — everything else stays neutral.',
    }];
  }
  return [];
}

function checkInconsistentIconStyle(input: CheckInput): Finding[] {
  if (!input.html) return [];
  const solid = (input.html.match(/<svg\b[^>]*\bfill="(?!none)[^"]*"[^>]*>/gi) || []).length;
  const outline = (input.html.match(/<svg\b[^>]*\bfill="none"[^>]*\bstroke="[^"]*"[^>]*>/gi) || []).length;
  if (solid >= 2 && outline >= 2) {
    return [{
      ruleId: 'inconsistent-icon-style',
      category: 'quality',
      name: 'Mixed icon styles',
      severity: 'advisory',
      description: `${outline} outline icons (stroke, fill:none) and ${solid} solid/filled icons appear in the same document. One icon system should commit to one convention.`,
      fix: 'Pick one icon style — stroke or solid — and keep it consistent. A recognizable third-party brand mark is a reasonable, deliberate exception.',
    }];
  }
  return [];
}

function checkHeadlineNoTextWrap(input: CheckInput): Finding[] {
  const css = input.css || '';
  if (!css) return [];
  const ruleRe = /h[12](?:[^{}]*)\{([^}]*)\}/gi;
  let m: RegExpExecArray | null;
  let hasLargeHeading = false;
  while ((m = ruleRe.exec(css))) {
    const body = m[1];
    if (/font-size\s*:\s*clamp\(/i.test(body)) { hasLargeHeading = true; continue; }
    const sizeMatch = body.match(/font-size\s*:\s*([\d.]+)(rem|em|px)/i);
    if (!sizeMatch) continue;
    const value = parseFloat(sizeMatch[1]);
    const px = sizeMatch[2].toLowerCase() === 'px' ? value : value * 16;
    if (px >= 32) hasLargeHeading = true;
  }
  if (hasLargeHeading && !/text-wrap\s*:\s*(?:balance|pretty)/i.test(css)) {
    return [{
      ruleId: 'headline-no-text-wrap',
      category: 'quality',
      name: 'Display heading without text-wrap',
      severity: 'advisory',
      description: 'A large (32px+) heading has no text-wrap: balance or text-wrap: pretty anywhere in the stylesheet. Long headlines are left to the browser\'s greedy line breaks, which routinely strands one or two words alone on the last line.',
      fix: 'Add text-wrap: balance to short headings, or text-wrap: pretty to longer ones.',
    }];
  }
  return [];
}

function checkCounterWithoutTabularNums(input: CheckInput): Finding[] {
  const source = (input.css || '') + (input.html || '');
  if (!source) return [];
  const looksLikeCounter = /textContent\s*=|innerText\s*=/.test(source) && /Math\.round|\bcountUp\b|\bcounter\b/i.test(source);
  const classCounter = /class="[^"]*\b(?:stat|count|counter|metric)s?\b[^"]*"/i.test(source);
  if ((looksLikeCounter || classCounter) && !/tabular-nums/i.test(source)) {
    return [{
      ruleId: 'counter-no-tabular-nums',
      category: 'quality',
      name: 'Animated or stat number without tabular-nums',
      severity: 'advisory',
      description: 'A counted-up or stat-style number has no font-variant-numeric: tabular-nums anywhere in the stylesheet. Proportional digits shift width as they change, so a counting animation visibly jitters.',
      fix: 'Add font-variant-numeric: tabular-nums to the element showing the number.',
    }];
  }
  return [];
}

function checkMissingLoadingState(input: CheckInput): Finding[] {
  const source = (input.css || '') + (input.html || '');
  if (!source) return [];
  const hasAsync = /\bfetch\s*\(|new XMLHttpRequest|axios\.(?:get|post)/i.test(source);
  const hasLoadingUi = /\b(?:skeleton|spinner|shimmer|placeholder|loading|aria-busy)\b/i.test(source);
  if (hasAsync && !hasLoadingUi) {
    return [{
      ruleId: 'missing-loading-state',
      category: 'quality',
      name: 'Async operation with no loading state',
      severity: 'advisory',
      description: 'The page fetches data but has no skeleton, spinner, shimmer, or aria-busy state anywhere. Between the click and the response, the UI gives no sign anything is happening.',
      fix: 'Show a skeleton, spinner, or a disabled/loading button state for the duration of the request.',
    }];
  }
  return [];
}

function checkNoInteractiveFeedback(input: CheckInput): Finding[] {
  if (!input.html || !input.css) return [];
  const hasButtons = /<button\b|class="[^"]*\bbtn\b[^"]*"/i.test(input.html);
  if (!hasButtons) return [];
  const hasFeedback = /:hover|:active|:focus(?:-visible)?|transition\s*:/i.test(input.css);
  if (!hasFeedback) {
    return [{
      ruleId: 'no-interactive-feedback',
      category: 'quality',
      name: 'No interactive feedback styling',
      severity: 'advisory',
      description: 'Buttons exist but the stylesheet has no :hover, :active, :focus, or transition rule anywhere. Every click lands on a surface that never visibly responds.',
      fix: 'Add at least a hover/active state and a short transition to every clickable element.',
    }];
  }
  return [];
}

// ══════════════════════════════════════════════════════════════════════════════
// QUALITY CHECKS
// ══════════════════════════════════════════════════════════════════════════════

function checkContrastRatio(input: CheckInput): Finding[] {
  const fgList = input.textColors?.length ? input.textColors : input.colors;
  if (!fgList?.length || !input.backgroundColors?.length) return [];
  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const fg of fgList) {
    for (const bg of input.backgroundColors) {
      const fgHex = fg.startsWith('#') ? fg : `#${fg}`;
      const bgHex = bg.startsWith('#') ? bg : `#${bg}`;
      const key = `${fgHex}:${bgHex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (fgHex.toLowerCase() === bgHex.toLowerCase()) continue; // same colour, not a real pair

      try {
        const ratio = contrastRatio(fgHex, bgHex);
        if (ratio > 0 && ratio < 3) {
          findings.push({
            ruleId: 'low-contrast',
            category: 'quality',
            name: 'Very low contrast',
            severity: 'error',
            description: `${ratio.toFixed(1)}:1 contrast between ${fgHex} and ${bgHex} fails WCAG AA for all text sizes (minimum 3:1 for large, 4.5:1 for body).`,
            snippet: `${fgHex} on ${bgHex}`,
            fix: 'Darken the text or lighten the background.',
          });
        } else if (ratio >= 3 && ratio < 4.5) {
          findings.push({
            ruleId: 'low-contrast-body',
            category: 'quality',
            name: 'Low body text contrast',
            severity: 'warning',
            description: `${ratio.toFixed(1)}:1 contrast between ${fgHex} and ${bgHex}. Passes for large text (3:1) but fails for body text (4.5:1).`,
            snippet: `${fgHex} on ${bgHex}`,
            fix: 'Only use this combination for headings 18px+ or bold 14px+.',
          });
        }
      } catch {
        // Skip invalid colors
      }
    }
  }
  return findings;
}

// ══════════════════════════════════════════════════════════════════════════════
// REGISTRY
// ══════════════════════════════════════════════════════════════════════════════

export const RULES: AntiPatternRule[] = [
  // Design slop
  { id: 'overused-font', category: 'slop', name: 'Overused font', description: 'AI monoculture font', check: checkOverusedFonts },
  { id: 'cream-palette', category: 'slop', name: 'Cream palette', description: 'Default AI warm surface', check: checkCreamPalette },
  { id: 'ai-palette', category: 'slop', name: 'AI color palette', description: 'Purple/cyan/Tailwind defaults', check: checkAIPalette },
  { id: 'gradient-text', category: 'slop', name: 'Gradient text', description: 'background-clip text gradient', check: checkGradientText },
  { id: 'dark-glow', category: 'slop', name: 'Glow shadow', description: 'Chromatic zero-offset shadow', check: checkDarkGlow },
  { id: 'radial-halo', category: 'slop', name: 'Radial halo', description: 'Gradient spotlight background', check: checkRadialHalo },
  { id: 'side-tab', category: 'slop', name: 'Side-tab border', description: 'Thick single-side card border', check: checkSideTabBorder },
  { id: 'bounce-easing', category: 'slop', name: 'Bounce easing', description: 'Bounce/elastic/spring animation', check: checkBounceEasing },
  { id: 'glassmorphism', category: 'slop', name: 'Glassmorphism', description: 'Backdrop-blur over translucent fill', check: checkGlassmorphism },
  { id: 'full-viewport-sections', category: 'slop', name: 'Stacked 100vh sections', description: 'Every section fills the screen', check: checkFullViewportSections },
  { id: 'uniform-radius', category: 'slop', name: 'Uniform large radius', description: 'rounded-xl on everything', check: checkUniformRadius },
  { id: 'emoji-headings', category: 'slop', name: 'Emoji headings', description: 'Emoji as heading decoration', check: checkEmojiHeadings },
  { id: 'icon-tile-heading', category: 'slop', name: 'Icon tile above heading', description: 'Icon-in-tile before every section heading', check: checkIconTileHeading },
  { id: 'stagger-reveal', category: 'slop', name: 'Staggered scroll reveal', description: 'Incrementing animation-delay on scroll', check: checkStaggerReveal },
  { id: 'filler-badge', category: 'slop', name: 'Filler badge above headline', description: 'Decorative pill restating the title above the <h1>', check: checkFillerBadge },
  { id: 'redundant-eyebrow', category: 'slop', name: 'Redundant eyebrow label', description: 'Uppercase kicker label the heading already covers', check: checkRedundantEyebrow },
  { id: 'monospace-costume', category: 'slop', name: 'Monospace costume', description: 'Monospace on non-code elements', check: checkMonospaceCostume },
  // Copy tells
  { id: 'ai-copy', category: 'copy', name: 'AI copy phrase', description: 'LLM filler phrases', check: checkAICopyPhrases },
  { id: 'ai-punctuation', category: 'copy', name: 'AI punctuation', description: 'Em-dash, exclamation, ellipsis density', check: checkAIPunctuation },
  { id: 'generic-testimonials', category: 'copy', name: 'Template testimonials', description: 'Generic praise phrases', check: checkGenericTestimonials },
  { id: 'random-italic', category: 'copy', name: 'Random italic', description: 'Decorative <em> on an ordinary word', check: checkRandomItalics },
  { id: 'generic-headline', category: 'copy', name: 'Generic headline', description: 'Template listicle headline shape', check: checkGenericHeadline },
  // Quality
  { id: 'pure-gray', category: 'quality', name: 'Pure gray', description: 'Untinted neutral gray', check: checkPureGrays },
  { id: 'pure-black', category: 'quality', name: 'Pure black', description: 'Unwarmed #000000', check: checkPureBlackWhite },
  { id: 'gray-on-color', category: 'quality', name: 'Gray on color', description: 'Untinted gray text on colored surface', check: checkGrayOnColor },
  { id: 'contrast', category: 'quality', name: 'Low contrast', description: 'WCAG AA contrast failure', check: checkContrastRatio },
  { id: 'no-design-tokens', category: 'quality', name: 'No design tokens', description: 'Hardcoded hex colors, zero CSS custom properties', check: checkNoDesignTokens },
  { id: 'hero-no-product-visual', category: 'quality', name: 'Hero has no product visual', description: 'Hero is text + buttons only, no image/video/demo', check: checkHeroNoProductVisual },
  { id: 'unemphasized-cta', category: 'quality', name: 'No emphasized CTA', description: 'Multiple buttons, none marked primary', check: checkUnemphasizedCta },
  { id: 'no-accent-color', category: 'quality', name: 'No accent color', description: 'Entire palette is neutral/desaturated', check: checkNoAccentColor },
  { id: 'inconsistent-icon-style', category: 'quality', name: 'Inconsistent icon style', description: 'Solid and outline icons mixed in one system', check: checkInconsistentIconStyle },
  { id: 'headline-no-text-wrap', category: 'quality', name: 'Headline without text-wrap', description: 'Large heading with no text-wrap: balance/pretty', check: checkHeadlineNoTextWrap },
  { id: 'counter-no-tabular-nums', category: 'quality', name: 'Counter without tabular-nums', description: 'Animated/stat number missing tabular-nums', check: checkCounterWithoutTabularNums },
  { id: 'missing-loading-state', category: 'quality', name: 'Missing loading state', description: 'Async fetch with no skeleton/spinner/busy state', check: checkMissingLoadingState },
  { id: 'no-interactive-feedback', category: 'quality', name: 'No interactive feedback', description: 'Buttons with no hover/active/transition styling', check: checkNoInteractiveFeedback },
];

/**
 * Run all rules against the given input.
 */
export function runAudit(input: CheckInput): Finding[] {
  const findings: Finding[] = [];
  for (const rule of RULES) {
    findings.push(...rule.check(input));
  }
  return findings;
}

/**
 * Audit design tokens specifically.
 */
export function auditTokens(tokens: {
  colors: Record<string, string>;
  typography?: { fontFamilies?: Record<string, string> };
}): Finding[] {
  const allColors = Object.values(tokens.colors);
  const fonts = tokens.typography?.fontFamilies
    ? Object.values(tokens.typography.fontFamilies)
        .flatMap(stack => stack.split(',').map(f => f.trim().replace(/['"]/g, '')))
    : [];

  const bgKeys = Object.keys(tokens.colors).filter(k => /background|bg|surface|base/i.test(k));
  const bgColors = bgKeys.map(k => tokens.colors[k]);
  // Contrast only makes sense for colours actually used as text.
  const textKeys = Object.keys(tokens.colors).filter(k => /foreground|text|ink/i.test(k));
  const textColors = textKeys.map(k => tokens.colors[k]);

  return runAudit({
    colors: allColors,
    textColors: textColors.length ? textColors : undefined,
    backgroundColors: bgColors,
    fonts: [...new Set(fonts)],
  });
}

/**
 * Audit a live-page DOM extraction (from browser/extract.ts). Runs colour/font
 * checks plus signals only visible on a real page.
 */
export function auditExtraction(extraction: {
  colors?: { allUnique?: string[]; backgrounds?: string[]; accents?: string[] };
  typography?: { headingFonts?: string[]; bodyFont?: string; fontSizes?: string[] };
  animations?: { totalAnimatedCount?: number; libraries?: string[]; scrollTriggered?: boolean };
  layout?: { stickyElements?: number; fixedElements?: number };
  libraries?: string[];
}): Finding[] {
  const findings: Finding[] = [];

  const rgbToHex = (c: string): string | null => {
    const m = c.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (!m) return c.startsWith('#') ? c : null;
    return '#' + [m[1], m[2], m[3]].map(n => parseInt(n, 10).toString(16).padStart(2, '0')).join('');
  };

  const colors = (extraction.colors?.allUnique || []).map(rgbToHex).filter((c): c is string => !!c);
  const backgrounds = (extraction.colors?.backgrounds || []).map(rgbToHex).filter((c): c is string => !!c);
  const fonts = [
    ...(extraction.typography?.headingFonts || []),
    extraction.typography?.bodyFont || '',
  ].flatMap(stack => stack.split(',').map(f => f.trim().replace(/['"]/g, ''))).filter(Boolean);

  // Cross-product contrast checks are meaningless without real fg/bg pairings —
  // an extraction is just two flat lists. Keep only the single worst pair.
  const raw = runAudit({ colors, backgroundColors: backgrounds, fonts: [...new Set(fonts)] });
  const contrast = raw.filter(f => f.ruleId === 'low-contrast' || f.ruleId === 'low-contrast-body');
  const rest = raw.filter(f => f.ruleId !== 'low-contrast' && f.ruleId !== 'low-contrast-body');
  findings.push(...rest);
  if (contrast.length) findings.push({ ...contrast[0], description: contrast[0].description + ' (worst of ' + contrast.length + ' extracted colour pairs — verify against real usage)' });

  // Sticky / fixed overload
  const sticky = extraction.layout?.stickyElements || 0;
  const fixed = extraction.layout?.fixedElements || 0;
  if (sticky + fixed >= 6) {
    findings.push({
      ruleId: 'sticky-overload',
      category: 'quality',
      name: 'Too many pinned elements',
      severity: 'advisory',
      description: `${sticky} sticky + ${fixed} fixed elements. Multiple competing pinned elements crowd the viewport and trap scroll.`,
      fix: 'Keep one pinned element (usually the nav). Let everything else scroll.',
    });
  }

  // Font count
  const uniqueFamilies = new Set(fonts.map(f => f.toLowerCase()));
  if (uniqueFamilies.size >= 4) {
    findings.push({
      ruleId: 'too-many-fonts',
      category: 'quality',
      name: 'Too many typefaces',
      severity: 'warning',
      description: `${uniqueFamilies.size} distinct font families in use. More than two or three reads as unresolved rather than expressive.`,
      snippet: [...uniqueFamilies].slice(0, 6).join(', '),
      fix: 'Pick one display face and one text face. Add a mono only if you show code.',
    });
  }

  // Animation library stack
  const animLibs = extraction.animations?.libraries || [];
  if (animLibs.length >= 3) {
    findings.push({
      ruleId: 'animation-stack',
      category: 'quality',
      name: 'Multiple animation libraries',
      severity: 'advisory',
      description: `${animLibs.length} animation libraries loaded (${animLibs.join(', ')}). Each adds weight and they often fight each other.`,
      fix: 'Consolidate on one. Most sites need only CSS transitions plus one scroll library at most.',
    });
  }

  return findings;
}

/**
 * Extract plain text from HTML for copy checks.
 */
export function extractTextFromHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Run copy-specific audit on text content.
 */
export function auditCopy(text: string): Finding[] {
  return runAudit({ text });
}

/**
 * Audit an HTML / JSX / CSS-in-markup string: copy tells from the visible text,
 * design tells from the markup, and contrast from colours classified by the
 * declaration they appear in (color: vs background:, --color-fg vs --color-bg).
 */
export function auditMarkup(content: string): Finding[] {
  const findings: Finding[] = [];
  const text = extractTextFromHtml(content);
  findings.push(...auditCopy(text));

  const colorMatches = content.match(/#[0-9a-fA-F]{6}\b/g) || [];
  const fontMatches = content.match(/font-family:\s*([^;}\n]+)/gi) || [];
  const fonts = fontMatches.flatMap(m =>
    m.replace(/font-family:\s*/i, '').split(',').map(f => f.trim().replace(/['"]/g, '')));

  const ctxBefore = (hex: string) => {
    const idx = content.indexOf(hex);
    return content.substring(Math.max(0, idx - 40), idx);
  };
  const isBg = (hex: string) => /(?:^|[^-])background(?:-color)?\s*:|--(?:color-)?(?:bg|background|surface)\b|\bbg-\[/i.test(ctxBefore(hex));
  const isText = (hex: string) => /(?:^|[^-])color\s*:|--(?:color-)?(?:fg|foreground|text|ink)\b|\btext-\[/i.test(ctxBefore(hex));

  const bgColors = [...new Set(colorMatches.filter(isBg))];
  const textColors = [...new Set(colorMatches.filter(isText))];

  findings.push(...runAudit({
    html: content,
    colors: [...new Set(colorMatches)],
    textColors: textColors.length ? textColors : undefined,
    backgroundColors: bgColors,
    fonts: [...new Set(fonts)],
  }));

  // Full-document hygiene — the "single biggest fix" in the v0.2 build feedback
  // was a missing <meta name="viewport">; a missing lang is close behind.
  const isFullDoc = /<html[\s>]/i.test(content) || /<!doctype\s+html/i.test(content);
  if (isFullDoc) {
    if (!/<meta[^>]+name=["']viewport["']/i.test(content)) {
      findings.push({
        ruleId: 'viewport-meta-missing', category: 'quality', severity: 'error',
        name: 'Missing viewport meta',
        description: 'No <meta name="viewport">. The page will not lay out responsively on mobile — content renders at desktop width and is zoomed out.',
        fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to <head>.',
      });
    }
    if (!/<html[^>]+\blang=/i.test(content)) {
      findings.push({
        ruleId: 'html-lang-missing', category: 'quality', severity: 'warning',
        name: 'Missing lang attribute',
        description: 'The <html> element has no lang attribute — assistive tech cannot pick the right pronunciation rules.',
        fix: 'Add lang="en" (or the correct language) to the <html> element.',
      });
    }
  }

  return findings;
}
