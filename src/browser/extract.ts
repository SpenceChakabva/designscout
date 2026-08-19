/**
 * Extraction scripts that run inside the Playwright browser context.
 * Each function is serialized and executed via page.evaluate().
 */

/** Full extraction result from a live page. */
export interface DomExtraction {
  colors: ExtractedColors;
  typography: ExtractedTypography;
  icons: ExtractedIcons;
  animations: ExtractedAnimations;
  layout: ExtractedLayout;
  libraries: string[];
  cssVariables: Record<string, string>;
  stylesheetUrls: string[];
}

export interface ExtractedColors {
  backgrounds: string[];
  foregrounds: string[];
  borders: string[];
  accents: string[];       // colors used on buttons, links, highlights
  allUnique: string[];     // deduplicated full list
}

export interface ExtractedTypography {
  loadedFonts: string[];           // fonts actually loaded (document.fonts)
  googleFonts: string[];           // Google Fonts URLs
  fontFaceDeclarations: string[];  // @font-face family names
  headingFonts: string[];          // computed font-family on h1-h6
  bodyFont: string;                // computed font-family on body/p
  fontSizes: string[];             // all unique font-size values
  fontWeights: string[];           // all unique font-weight values
  lineHeights: string[];           // all unique line-height values
  letterSpacings: string[];        // all unique letter-spacing values
}

export interface ExtractedIcons {
  libraries: string[];             // detected icon libraries
  svgCount: number;                // inline SVG elements
  svgSamples: string[];            // first 10 SVG outerHTML (trimmed)
  iconFontClasses: string[];       // icon CSS classes found (fa-*, material-icons, etc.)
  iconImageCount: number;          // small images likely used as icons
}

export interface ExtractedAnimations {
  keyframes: KeyframeInfo[];       // @keyframes definitions
  transitions: TransitionInfo[];   // elements with transitions
  animatedElements: AnimatedElementInfo[];
  libraries: string[];             // detected animation libraries
  scrollTriggered: boolean;        // any scroll-based animations detected
  totalAnimatedCount: number;
}

export interface KeyframeInfo {
  name: string;
  properties: string[];            // which CSS properties are animated
}

export interface TransitionInfo {
  selector: string;
  property: string;
  duration: string;
  easing: string;
}

export interface AnimatedElementInfo {
  tag: string;
  classes: string;
  animationName: string;
  animationDuration: string;
  animationEasing: string;
}

export interface ExtractedLayout {
  containerMaxWidths: string[];
  gridUsage: number;               // count of grid containers
  flexUsage: number;               // count of flex containers
  breakpoints: string[];           // from media queries in stylesheets
  stickyElements: number;
  fixedElements: number;
}

/**
 * The script that runs inside the browser to extract everything.
 * Must be a plain function with no external dependencies.
 */
export async function extractFromPage(): Promise<DomExtraction> {
  // ── COLORS ──
  const colorSet = new Set<string>();
  const bgColors: string[] = [];
  const fgColors: string[] = [];
  const borderColors: string[] = [];
  const accentColors: string[] = [];

  const allElements = document.querySelectorAll('*');
  const sampleSize = Math.min(allElements.length, 500);
  const step = Math.max(1, Math.floor(allElements.length / sampleSize));

  for (let i = 0; i < allElements.length; i += step) {
    const el = allElements[i] as HTMLElement;
    const style = getComputedStyle(el);
    const tag = el.tagName.toLowerCase();

    // Background color
    const bg = style.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      bgColors.push(bg);
      colorSet.add(bg);
    }

    // Text color
    const fg = style.color;
    if (fg) { fgColors.push(fg); colorSet.add(fg); }

    // Border color
    const bc = style.borderColor;
    if (bc && bc !== fg && bc !== 'rgb(0, 0, 0)') {
      borderColors.push(bc);
      colorSet.add(bc);
    }

    // Accent colors (buttons, links, highlighted elements)
    if (tag === 'a' || tag === 'button' || el.getAttribute('role') === 'button') {
      if (bg && bg !== 'rgba(0, 0, 0, 0)') accentColors.push(bg);
      if (fg) accentColors.push(fg);
    }
  }

  // ── TYPOGRAPHY ──
  const loadedFonts: string[] = [];
  try {
    document.fonts.forEach(f => {
      if (f.status === 'loaded') loadedFonts.push(f.family);
    });
  } catch {}

  const googleFonts = Array.from(document.querySelectorAll('link[href*="fonts.googleapis"], link[href*="fonts.gstatic"]'))
    .map(el => el.getAttribute('href') || '')
    .filter(Boolean);

  // @font-face from stylesheets
  const fontFaceDeclarations: string[] = [];
  const allFontSizes = new Set<string>();
  const allFontWeights = new Set<string>();
  const allLineHeights = new Set<string>();
  const allLetterSpacings = new Set<string>();

  try {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules || [])) {
          if (rule instanceof CSSFontFaceRule) {
            const family = rule.style.getPropertyValue('font-family').replace(/['"]/g, '');
            if (family) fontFaceDeclarations.push(family);
          }
        }
      } catch {}
    }
  } catch {}

  // Heading fonts
  const headingFonts: string[] = [];
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    const el = document.querySelector(tag);
    if (el) {
      const style = getComputedStyle(el);
      headingFonts.push(style.fontFamily);
      allFontSizes.add(style.fontSize);
      allFontWeights.add(style.fontWeight);
      allLineHeights.add(style.lineHeight);
      allLetterSpacings.add(style.letterSpacing);
    }
  }

  // Body font
  const bodyEl = document.querySelector('p') || document.body;
  const bodyStyle = getComputedStyle(bodyEl);
  const bodyFont = bodyStyle.fontFamily;

  // Sample font sizes from visible elements
  for (let i = 0; i < allElements.length; i += step) {
    const style = getComputedStyle(allElements[i]);
    allFontSizes.add(style.fontSize);
    allFontWeights.add(style.fontWeight);
    allLineHeights.add(style.lineHeight);
    const ls = style.letterSpacing;
    if (ls !== 'normal') allLetterSpacings.add(ls);
  }

  // ── ICONS ──
  const iconLibraries: string[] = [];
  const iconClasses: string[] = [];

  // Detect icon font libraries
  const allClasses = Array.from(document.querySelectorAll('[class]'))
    .flatMap(el => Array.from(el.classList));

  const iconPatterns: [RegExp, string][] = [
    [/^fa[srldb]?$|^fa-/, 'Font Awesome'],
    [/^material-icons|^mdi-/, 'Material Icons'],
    [/^bi-/, 'Bootstrap Icons'],
    [/^icon-|^icofont-/, 'IcoFont'],
    [/^ri-/, 'Remix Icon'],
    [/^ph-|^ph$/, 'Phosphor Icons'],
    [/^lucide-/, 'Lucide'],
    [/^tabler-icon|^ti-/, 'Tabler Icons'],
    [/^heroicon/, 'Heroicons'],
    [/^feather-/, 'Feather Icons'],
  ];

  const detectedLibs = new Set<string>();
  for (const cls of allClasses) {
    for (const [pattern, name] of iconPatterns) {
      if (pattern.test(cls)) {
        detectedLibs.add(name);
        iconClasses.push(cls);
      }
    }
  }
  iconLibraries.push(...detectedLibs);

  // Check for icon font stylesheets
  const linkHrefs = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map(el => el.getAttribute('href') || '');
  for (const href of linkHrefs) {
    if (/font-?awesome/i.test(href)) detectedLibs.add('Font Awesome');
    if (/material.*icon/i.test(href)) detectedLibs.add('Material Icons');
    if (/bootstrap-icons/i.test(href)) detectedLibs.add('Bootstrap Icons');
    if (/phosphor/i.test(href)) detectedLibs.add('Phosphor Icons');
  }

  // Inline SVGs
  const svgs = document.querySelectorAll('svg');
  const svgSamples = Array.from(svgs).slice(0, 10).map(svg => {
    const clone = svg.cloneNode(true) as Element;
    // Strip large path data for storage
    clone.querySelectorAll('path').forEach(p => {
      const d = p.getAttribute('d') || '';
      if (d.length > 100) p.setAttribute('d', d.slice(0, 80) + '...');
    });
    return clone.outerHTML.slice(0, 500);
  });

  // Small images as icons (under 48x48)
  const iconImages = Array.from(document.querySelectorAll('img')).filter(img => {
    return img.naturalWidth > 0 && img.naturalWidth <= 48 && img.naturalHeight <= 48;
  });

  // ── ANIMATIONS ──
  const keyframes: { name: string; properties: string[] }[] = [];
  const transitions: { selector: string; property: string; duration: string; easing: string }[] = [];
  const animatedElements: { tag: string; classes: string; animationName: string; animationDuration: string; animationEasing: string }[] = [];
  const animLibraries: string[] = [];

  // Extract @keyframes from stylesheets
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules || [])) {
          if (rule instanceof CSSKeyframesRule) {
            const props = new Set<string>();
            for (const kf of Array.from(rule.cssRules)) {
              if (kf instanceof CSSKeyframeRule) {
                for (let p = 0; p < kf.style.length; p++) {
                  props.add(kf.style[p]);
                }
              }
            }
            keyframes.push({ name: rule.name, properties: [...props] });
          }
        }
      } catch {}
    }
  } catch {}

  // Find elements with transitions or animations
  let animatedCount = 0;
  for (let i = 0; i < allElements.length; i += step) {
    const el = allElements[i] as HTMLElement;
    const style = getComputedStyle(el);

    const tp = style.transitionProperty;
    const td = style.transitionDuration;
    if (tp && tp !== 'none' && tp !== 'all' && td !== '0s') {
      transitions.push({
        selector: el.tagName.toLowerCase() + (el.className ? '.' + el.className.split(' ')[0] : ''),
        property: tp,
        duration: td,
        easing: style.transitionTimingFunction,
      });
    }

    const an = style.animationName;
    if (an && an !== 'none') {
      animatedCount++;
      if (animatedElements.length < 20) {
        animatedElements.push({
          tag: el.tagName.toLowerCase(),
          classes: el.className,
          animationName: an,
          animationDuration: style.animationDuration,
          animationEasing: style.animationTimingFunction,
        });
      }
    }
  }

  // Detect animation libraries by script tags and global variables
  const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => s.getAttribute('src') || '');
  const scriptContent = scripts.join(' ');

  if (/gsap/i.test(scriptContent) || (window as any).gsap) animLibraries.push('GSAP');
  if (/ScrollTrigger/i.test(scriptContent)) animLibraries.push('GSAP ScrollTrigger');
  if (/framer-motion|motion/i.test(scriptContent)) animLibraries.push('Framer Motion');
  if (/animejs|anime\.min/i.test(scriptContent) || (window as any).anime) animLibraries.push('Anime.js');
  if (/lenis/i.test(scriptContent) || (window as any).Lenis) animLibraries.push('Lenis');
  if (/locomotive/i.test(scriptContent)) animLibraries.push('Locomotive Scroll');
  if (/aos/i.test(scriptContent) || document.querySelector('[data-aos]')) animLibraries.push('AOS');
  if (/three\.js|three\.min/i.test(scriptContent) || (window as any).THREE) animLibraries.push('Three.js');
  if (/popmotion/i.test(scriptContent)) animLibraries.push('Popmotion');
  if (/lottie/i.test(scriptContent)) animLibraries.push('Lottie');
  if (/motion\.dev/i.test(scriptContent)) animLibraries.push('Motion One');
  if (/barba/i.test(scriptContent)) animLibraries.push('Barba.js');
  if (/swiper/i.test(scriptContent)) animLibraries.push('Swiper');

  // Detect scroll-triggered animations
  const scrollTriggered = !!document.querySelector('[data-aos], [data-scroll], [data-gsap], .gsap-reveal, .scroll-reveal, .reveal, .animate-on-scroll') ||
    animLibraries.some(l => l.includes('ScrollTrigger') || l.includes('AOS') || l.includes('Locomotive'));

  // ── LAYOUT ──
  const containerMaxWidths = new Set<string>();
  let gridCount = 0;
  let flexCount = 0;
  let stickyCount = 0;
  let fixedCount = 0;

  for (let i = 0; i < allElements.length; i += step) {
    const style = getComputedStyle(allElements[i]);
    if (style.display === 'grid' || style.display === 'inline-grid') gridCount++;
    if (style.display === 'flex' || style.display === 'inline-flex') flexCount++;
    if (style.position === 'sticky') stickyCount++;
    if (style.position === 'fixed') fixedCount++;
    const mw = style.maxWidth;
    if (mw && mw !== 'none' && mw !== '100%') containerMaxWidths.add(mw);
  }

  // Breakpoints from media queries
  const breakpoints = new Set<string>();
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules || [])) {
          if (rule instanceof CSSMediaRule) {
            const match = rule.conditionText.match(/(\d+)px/g);
            if (match) match.forEach(bp => breakpoints.add(bp));
          }
        }
      } catch {}
    }
  } catch {}

  // ── CSS VARIABLES ──
  const cssVars: Record<string, string> = {};
  const rootStyle = getComputedStyle(document.documentElement);
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules || [])) {
          if (rule instanceof CSSStyleRule && rule.selectorText === ':root') {
            for (let i = 0; i < rule.style.length; i++) {
              const prop = rule.style[i];
              if (prop.startsWith('--')) {
                cssVars[prop] = rule.style.getPropertyValue(prop).trim();
              }
            }
          }
        }
      } catch {}
    }
  } catch {}

  // ── STYLESHEET URLS ──
  const stylesheetUrls = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map(el => el.getAttribute('href') || '')
    .filter(Boolean);

  // ── DETECTED LIBRARIES (general) ──
  const libraries: string[] = [...animLibraries];
  if (/tailwindcss|tailwind/i.test(document.documentElement.innerHTML.slice(0, 50000))) libraries.push('Tailwind CSS');
  if (/bootstrap/i.test(scriptContent + stylesheetUrls.join(' '))) libraries.push('Bootstrap');
  if (document.querySelector('[class*="chakra-"]')) libraries.push('Chakra UI');
  if (document.querySelector('[class*="MuiBox"], [class*="css-"][class*="Mui"]')) libraries.push('Material UI');
  if (/next/i.test(document.querySelector('meta[name="next-head-count"]')?.getAttribute('content') || '')) libraries.push('Next.js');
  if (document.getElementById('__nuxt')) libraries.push('Nuxt');
  if (document.getElementById('svelte-announcer') || document.querySelector('[class*="svelte-"]')) libraries.push('Svelte');
  if (/react/i.test(scriptContent) || document.getElementById('__next')) { if (!libraries.includes('Next.js')) libraries.push('React'); }

  const dedup = (arr: string[]) => [...new Set(arr)];

  return {
    colors: {
      backgrounds: dedup(bgColors).slice(0, 30),
      foregrounds: dedup(fgColors).slice(0, 30),
      borders: dedup(borderColors).slice(0, 20),
      accents: dedup(accentColors).slice(0, 15),
      allUnique: [...colorSet].slice(0, 50),
    },
    typography: {
      loadedFonts: dedup(loadedFonts),
      googleFonts,
      fontFaceDeclarations: dedup(fontFaceDeclarations),
      headingFonts: dedup(headingFonts),
      bodyFont,
      fontSizes: [...allFontSizes].sort(),
      fontWeights: [...allFontWeights].sort(),
      lineHeights: [...allLineHeights].slice(0, 10),
      letterSpacings: [...allLetterSpacings].slice(0, 10),
    },
    icons: {
      libraries: dedup(iconLibraries),
      svgCount: svgs.length,
      svgSamples,
      iconFontClasses: dedup(iconClasses).slice(0, 30),
      iconImageCount: iconImages.length,
    },
    animations: {
      keyframes,
      transitions: transitions.slice(0, 20),
      animatedElements,
      libraries: dedup(animLibraries),
      scrollTriggered,
      totalAnimatedCount: animatedCount,
    },
    layout: {
      containerMaxWidths: [...containerMaxWidths].slice(0, 10),
      gridUsage: gridCount,
      flexUsage: flexCount,
      breakpoints: [...breakpoints].sort((a, b) => parseInt(a) - parseInt(b)),
      stickyElements: stickyCount,
      fixedElements: fixedCount,
    },
    libraries: dedup(libraries),
    cssVariables: cssVars,
    stylesheetUrls,
  };
}
