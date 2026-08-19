import type { DesignPattern, DesignTokenSet } from '../shared/types.js';

/**
 * Generate a DESIGN.md from captured patterns and tokens.
 * Compatible with impeccable's DESIGN.md format so other AI tools can read it.
 */
export function generateDesignMd(
  siteName: string,
  patterns: DesignPattern[],
  tokens: DesignTokenSet,
): string {
  const colorPattern = patterns.find(p => p.category === 'color' && p.subcategory === 'palette');
  const typoPattern = patterns.find(p => p.category === 'typography');
  const moodPattern = patterns.find(p => p.category === 'mood');
  const layoutPatterns = patterns.filter(p => p.category === 'layout');
  const componentPatterns = patterns.filter(p => p.category === 'component');

  const mood = (moodPattern?.data as any)?.mood || 'not analyzed';
  const signatures = ((moodPattern?.data as any)?.signatureElements || []) as string[];

  const lines: string[] = [];

  lines.push(`---`);
  lines.push(`name: ${siteName}`);
  lines.push(`description: Design system extracted by DesignScout from captured site analysis.`);
  lines.push(``);
  lines.push(`colors:`);
  for (const [name, value] of Object.entries(tokens.colors)) {
    lines.push(`  ${name}: "${value}"`);
  }
  lines.push(``);
  lines.push(`typography:`);
  if (tokens.typography.fontFamilies) {
    lines.push(`  families:`);
    for (const [role, stack] of Object.entries(tokens.typography.fontFamilies)) {
      lines.push(`    ${role}: "${stack}"`);
    }
  }
  if (tokens.typography.fontSizes) {
    lines.push(`  scale:`);
    for (const [name, size] of Object.entries(tokens.typography.fontSizes)) {
      lines.push(`    ${name}: "${size}"`);
    }
  }
  lines.push(`---`);
  lines.push(``);
  lines.push(`# Design System: ${siteName}`);
  lines.push(``);
  lines.push(`Extracted by DesignScout. This file follows the impeccable DESIGN.md format`);
  lines.push(`so any AI coding tool with impeccable installed can read and enforce it.`);
  lines.push(``);

  // Mood and identity
  lines.push(`## 1. Identity`);
  lines.push(``);
  lines.push(`**Mood:** ${mood}`);
  if (signatures.length > 0) {
    lines.push(`**Signature elements:** ${signatures.join('; ')}`);
  }
  lines.push(``);

  // Colors
  lines.push(`## 2. Color`);
  lines.push(``);
  lines.push(`| Token | Value | Usage |`);
  lines.push(`|---|---|---|`);
  for (const [name, value] of Object.entries(tokens.colors)) {
    const usage = name.includes('background') || name.includes('bg') ? 'Surface'
      : name.includes('foreground') || name.includes('text') ? 'Text'
      : name.includes('primary') ? 'Primary action'
      : name.includes('secondary') ? 'Secondary'
      : name.includes('accent') ? 'Accent'
      : name.includes('muted') ? 'Muted / disabled'
      : name.includes('border') ? 'Borders'
      : 'General';
    lines.push(`| ${name} | \`${value}\` | ${usage} |`);
  }
  lines.push(``);

  // Typography
  lines.push(`## 3. Typography`);
  lines.push(``);
  if (tokens.typography.fontFamilies) {
    for (const [role, stack] of Object.entries(tokens.typography.fontFamilies)) {
      lines.push(`**${role.charAt(0).toUpperCase() + role.slice(1)}:** \`${stack}\``);
    }
  }
  lines.push(``);
  if (typoPattern) {
    const typo = typoPattern.data as any;
    lines.push(`Headings use ${typo.headingStyle || 'sans'} faces at ${typo.headingWeight || 'bold'} weight.`);
    lines.push(`Body uses ${typo.bodyStyle || 'sans'} faces.`);
    if (typo.notable) lines.push(`Notable: ${typo.notable}`);
  }
  lines.push(``);

  // Layout patterns
  if (layoutPatterns.length > 0) {
    lines.push(`## 4. Layout`);
    lines.push(``);
    for (const lp of layoutPatterns) {
      lines.push(`**${lp.subcategory || 'section'}:** ${lp.description}`);
    }
    lines.push(``);
  }

  // Components
  if (componentPatterns.length > 0) {
    lines.push(`## 5. Components`);
    lines.push(``);
    for (const cp of componentPatterns) {
      lines.push(`**${cp.subcategory || 'component'}:** ${cp.description}`);
    }
    lines.push(``);
  }

  // Spacing
  lines.push(`## 6. Spacing`);
  lines.push(``);
  lines.push(`| Token | Value |`);
  lines.push(`|---|---|`);
  for (const [name, value] of Object.entries(tokens.spacing)) {
    lines.push(`| ${name} | ${value} |`);
  }
  lines.push(``);

  // Do / Do not
  lines.push(`## 7. Do and Do Not`);
  lines.push(``);
  lines.push(`### Do`);
  lines.push(``);
  lines.push(`- Use the documented color tokens; do not introduce ad-hoc hex values.`);
  lines.push(`- Use the type scale; do not invent intermediate sizes.`);
  lines.push(`- Tint neutral grays toward the primary hue.`);
  lines.push(`- Use the spacing scale for consistent rhythm.`);
  lines.push(``);
  lines.push(`### Do Not`);
  lines.push(``);
  lines.push(`- Do not use overused fonts (Inter, Roboto, Geist, etc.) unless they are part of this system.`);
  lines.push(`- Do not use pure black or pure gray; always tint.`);
  lines.push(`- Do not use purple gradients, neon cyan, or glassmorphism.`);
  lines.push(`- Do not use em-dashes excessively in copy.`);
  lines.push(`- Do not use AI filler phrases (elevate, leverage, streamline, game-changer).`);
  lines.push(`- Do not trail every CTA with an arrow (→).`);
  lines.push(``);

  return lines.join('\n');
}
