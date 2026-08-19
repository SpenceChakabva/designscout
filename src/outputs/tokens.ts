import type { DesignPattern, DesignTokenSet, TokenFormat, ColorPalette, TypographyAnalysis } from '../shared/types.js';

/**
 * Generate a design token set from extracted patterns.
 */
export function generateTokens(patterns: DesignPattern[]): DesignTokenSet {
  const colorPattern = patterns.find((p) => p.category === 'color' && p.subcategory === 'palette');
  const typoPattern = patterns.find((p) => p.category === 'typography');
  const layoutPatterns = patterns.filter((p) => p.category === 'layout');
  const moodPattern = patterns.find((p) => p.category === 'mood');

  const colors = colorPattern?.data as ColorPalette | undefined;
  const typography = typoPattern?.data as TypographyAnalysis | undefined;

  // Build spacing scale based on layout density
  const density = layoutPatterns[0]?.data?.spacingDensity as string || 'comfortable';
  const spacingScale = buildSpacingScale(density);

  // Map font styles to common font stacks
  const headingFont = mapFontStack(typography?.headingStyle || 'sans');
  const bodyFont = mapFontStack(typography?.bodyStyle || 'sans');

  // Build type scale from ratio
  const ratio = typography?.estimatedScaleRatio || 1.25;
  const fontSizes = buildTypeScale(ratio);

  const primaryHex = colors?.primary || '#2563eb';

  // Tint fallback grays toward the primary hue to avoid the pure-gray anti-pattern
  const tintedForeground = tintGray(colors?.textPrimary || '#111111', primaryHex);
  const tintedMuted = tintGray(colors?.textSecondary || '#94a3b8', primaryHex);
  const tintedMutedFg = tintGray(colors?.textSecondary || '#64748b', primaryHex);

  return {
    id: '',
    colors: {
      background: colors?.background || '#ffffff',
      foreground: tintedForeground,
      primary: primaryHex,
      'primary-foreground': '#ffffff',
      secondary: colors?.secondary || tintGray('#64748b', primaryHex),
      'secondary-foreground': '#ffffff',
      accent: colors?.accent || '#f59e0b',
      'accent-foreground': '#000000',
      muted: tintedMuted,
      'muted-foreground': tintedMutedFg,
      border: adjustAlpha(tintedForeground, 0.1),
      ring: primaryHex,
    },
    typography: {
      fontFamilies: {
        heading: headingFont,
        body: bodyFont,
        mono: "'JetBrains Mono', 'Fira Code', monospace",
      },
      fontSizes,
      fontWeights: {
        light: 300,
        regular: 400,
        medium: 500,
        semibold: 600,
        bold: 700,
        black: 900,
      },
      lineHeights: {
        tight: '1.1',
        snug: '1.25',
        normal: '1.5',
        relaxed: '1.75',
      },
    },
    spacing: spacingScale,
    borderRadius: {
      none: '0',
      sm: '0.25rem',
      md: '0.5rem',
      lg: '1rem',
      xl: '1.5rem',
      full: '9999px',
    },
    shadows: {
      sm: '0 1px 2px rgba(0,0,0,0.05)',
      md: '0 4px 6px rgba(0,0,0,0.07)',
      lg: '0 10px 15px rgba(0,0,0,0.1)',
      xl: '0 20px 25px rgba(0,0,0,0.1)',
    },
    breakpoints: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
  };
}

/**
 * Format tokens for output.
 */
export function formatTokens(tokens: DesignTokenSet, format: TokenFormat): string {
  switch (format) {
    case 'css':
      return toCssCustomProperties(tokens);
    case 'tailwind':
      return toTailwindConfig(tokens);
    case 'json':
    default:
      return JSON.stringify(tokens, null, 2);
  }
}

function toCssCustomProperties(tokens: DesignTokenSet): string {
  const lines = [':root {'];

  // Colors
  lines.push('  /* Colors */');
  for (const [name, value] of Object.entries(tokens.colors)) {
    lines.push(`  --color-${name}: ${value};`);
  }

  // Typography
  lines.push('\n  /* Typography */');
  for (const [name, value] of Object.entries(tokens.typography.fontFamilies)) {
    lines.push(`  --font-${name}: ${value};`);
  }
  for (const [name, value] of Object.entries(tokens.typography.fontSizes)) {
    lines.push(`  --text-${name}: ${value};`);
  }
  for (const [name, value] of Object.entries(tokens.typography.lineHeights)) {
    lines.push(`  --leading-${name}: ${value};`);
  }

  // Spacing
  lines.push('\n  /* Spacing */');
  for (const [name, value] of Object.entries(tokens.spacing)) {
    lines.push(`  --space-${name}: ${value};`);
  }

  // Border radius
  lines.push('\n  /* Border Radius */');
  for (const [name, value] of Object.entries(tokens.borderRadius)) {
    lines.push(`  --radius-${name}: ${value};`);
  }

  // Shadows
  lines.push('\n  /* Shadows */');
  for (const [name, value] of Object.entries(tokens.shadows)) {
    lines.push(`  --shadow-${name}: ${value};`);
  }

  lines.push('}');
  return lines.join('\n');
}

function toTailwindConfig(tokens: DesignTokenSet): string {
  const config = {
    theme: {
      extend: {
        colors: tokens.colors,
        fontFamily: Object.fromEntries(
          Object.entries(tokens.typography.fontFamilies).map(([k, v]) => [k, [v]])
        ),
        fontSize: tokens.typography.fontSizes,
        spacing: tokens.spacing,
        borderRadius: tokens.borderRadius,
        boxShadow: tokens.shadows,
      },
    },
  };

  return `/** @type {import('tailwindcss').Config} */
export default ${JSON.stringify(config, null, 2)};`;
}

// ── Helpers ──

function buildSpacingScale(density: string): Record<string, string> {
  const base = density === 'tight' ? 0.2 : density === 'spacious' ? 0.35 : 0.25;
  return {
    '0': '0',
    'px': '1px',
    '0.5': `${base}rem`,
    '1': `${base * 2}rem`,
    '2': `${base * 4}rem`,
    '3': `${base * 6}rem`,
    '4': `${base * 8}rem`,
    '5': `${base * 10}rem`,
    '6': `${base * 12}rem`,
    '8': `${base * 16}rem`,
    '10': `${base * 20}rem`,
    '12': `${base * 24}rem`,
    '16': `${base * 32}rem`,
  };
}

function buildTypeScale(ratio: number): Record<string, string> {
  const base = 1; // 1rem = 16px
  return {
    xs: `${(base / ratio / ratio).toFixed(3)}rem`,
    sm: `${(base / ratio).toFixed(3)}rem`,
    base: `${base}rem`,
    lg: `${(base * ratio).toFixed(3)}rem`,
    xl: `${(base * ratio * ratio).toFixed(3)}rem`,
    '2xl': `${(base * Math.pow(ratio, 3)).toFixed(3)}rem`,
    '3xl': `${(base * Math.pow(ratio, 4)).toFixed(3)}rem`,
    '4xl': `${(base * Math.pow(ratio, 5)).toFixed(3)}rem`,
    '5xl': `${(base * Math.pow(ratio, 6)).toFixed(3)}rem`,
  };
}

function mapFontStack(style: string): string {
  // Deliberately avoids impeccable's overused-font list:
  // Inter, Roboto, Geist, Space Grotesk, Plus Jakarta Sans, etc.
  switch (style) {
    case 'serif':
      return "'Literata', 'Crimson Pro', 'Source Serif 4', Georgia, serif";
    case 'mono':
      return "'JetBrains Mono', 'Fira Code', 'IBM Plex Mono', monospace";
    case 'display':
      return "'Syne', 'Outfit', 'Cabinet Grotesk', sans-serif";
    case 'sans':
    default:
      return "'DM Sans', 'Satoshi', 'General Sans', system-ui, sans-serif";
  }
}

/**
 * Tint a pure gray toward a hue extracted from the primary color.
 * Prevents the "pure-gray" anti-pattern.
 */
function tintGray(hex: string, primaryHex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  // Check if it's a pure gray (r ≈ g ≈ b)
  if (Math.abs(r - g) > 5 || Math.abs(g - b) > 5) return hex;

  // Extract hue direction from primary color
  const pr = parseInt(primaryHex.slice(1, 3), 16);
  const pg = parseInt(primaryHex.slice(3, 5), 16);
  const pb = parseInt(primaryHex.slice(5, 7), 16);

  // Find dominant channel and shift gray toward it
  const max = Math.max(pr, pg, pb);
  const shift = 8; // subtle tint
  const nr = r + (pr === max ? shift : -Math.floor(shift / 2));
  const ng = g + (pg === max ? shift : -Math.floor(shift / 2));
  const nb = b + (pb === max ? shift : -Math.floor(shift / 2));

  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clamp(nr).toString(16).padStart(2, '0')}${clamp(ng).toString(16).padStart(2, '0')}${clamp(nb).toString(16).padStart(2, '0')}`;
}

function adjustAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
