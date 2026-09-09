import type { DesignPattern } from '../shared/types.js';

/**
 * Motion layer generator.
 *
 * Turns the animation signals that scout_capture already records (GSAP /
 * ScrollTrigger / Lenis, easings, keyframes, scroll-triggered flags) into a
 * drop-in scroll/reveal/parallax layer — the thing that, per the field feedback,
 * was hand-written on every build.
 *
 * Guard discipline (non-negotiable, encoded in the emitted code):
 *   - The controller reads `prefers-reduced-motion` first. On the GSAP path it
 *     also checks `window.gsap && window.ScrollTrigger`. If motion is off (or the
 *     library is absent), it sets every final state and returns WITHOUT adding
 *     any resting-hidden class.
 *   - Resting `opacity: 0` / transforms live only under `html.anim-ready`, which
 *     JS adds ONLY after it has confirmed it will animate. With no `.anim-ready`,
 *     every element is visible.
 *   - `themeTransition` uses the View Transitions API behind a support check and
 *     degrades to an instant swap.
 */

export type MotionLibrary = 'none' | 'gsap';

export type ThemeTransition = 'none' | 'fade' | 'iris' | 'wipe';

export type MotionEffect =
  | 'reveal'
  | 'stagger'
  | 'parallax'
  | 'line-mask'
  | 'count-up'
  | 'marquee'
  | 'magnetic'
  | 'blur-in';

/** Every effect key this generator understands, in canonical emit order. */
export const MOTION_EFFECTS: MotionEffect[] = [
  'reveal',
  'stagger',
  'parallax',
  'line-mask',
  'count-up',
  'marquee',
  'magnetic',
  'blur-in',
];

export interface DetectedMotion {
  /** Animation libraries seen on the reference (e.g. "GSAP", "Lenis"). */
  libraries: string[];
  /** Easing / timing-function strings observed. */
  easings: string[];
  /** `@keyframes` names observed. */
  keyframeNames: string[];
  /** The reference has scroll-linked animation. */
  scrollTriggered: boolean;
  /** The reference runs a smooth-scroll layer (Lenis / Locomotive). */
  smoothScroll: boolean;
  /** Sensible library default given what was detected. */
  suggestedLibrary: MotionLibrary;
  /** Sensible effect set given what was detected. */
  suggestedEffects: MotionEffect[];
}

export interface MotionLayerOptions {
  library?: MotionLibrary;
  effects?: MotionEffect[];
  smoothScroll?: boolean;
  themeTransition?: ThemeTransition;
  brief?: string;
  detected?: DetectedMotion;
}

export interface MotionLayer {
  css: string;
  js: string;
  html: string;
  notes: string[];
  effects: string[];
}

// ════════════════════════════════════════════════════════════════════════════
// describeDetected — stored capture patterns → DetectedMotion
// ════════════════════════════════════════════════════════════════════════════

/**
 * Read stored capture patterns (a `mood` / `animation` pattern's `data`, in
 * whatever shape it was persisted) and summarise what the reference is doing so
 * generateMotionLayer can pick sensible defaults. Entirely defensive: unknown
 * shapes just contribute nothing.
 */
export function describeDetected(patterns: DesignPattern[] = []): DetectedMotion {
  const libraries = new Set<string>();
  const easings = new Set<string>();
  const keyframeNames = new Set<string>();
  let scrollTriggered = false;
  let smoothScroll = false;
  const words: string[] = [];

  const visit = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === 'string') {
      words.push(value);
      return;
    }
    if (typeof value !== 'object') return;

    const o = value as Record<string, unknown>;
    if (typeof o.scrollTriggered === 'boolean' && o.scrollTriggered) scrollTriggered = true;
    if (typeof o.smoothScroll === 'boolean' && o.smoothScroll) smoothScroll = true;
    if (typeof o.name === 'string' && Array.isArray(o.properties)) keyframeNames.add(o.name);

    for (const key of ['easing', 'animationEasing', 'transitionTimingFunction', 'ease']) {
      const v = o[key];
      if (typeof v === 'string' && v.trim()) easings.add(v.trim());
    }
    for (const key of ['libraries', 'animationLibraries']) {
      const arr = o[key];
      if (Array.isArray(arr)) {
        for (const lib of arr) if (typeof lib === 'string' && lib.trim()) libraries.add(lib.trim());
      }
    }
    for (const v of Object.values(o)) visit(v);
  };

  for (const pattern of patterns) {
    if (!pattern) continue;
    visit(pattern.data);
    if (pattern.description) words.push(pattern.description);
    if (pattern.subcategory) words.push(pattern.subcategory);
  }

  const libBlob = [...libraries].join(' ').toLowerCase();
  const blob = words.join(' ').toLowerCase();
  const mentions = (re: RegExp): boolean => re.test(blob) || re.test(libBlob);

  if (/gsap|greensock/.test(libBlob)) libraries.add('GSAP');
  if (/scrolltrigger/.test(libBlob)) scrollTriggered = true;
  if (/lenis|locomotive/.test(libBlob) || /smooth[- ]?scroll|lenis|locomotive/.test(blob)) {
    smoothScroll = true;
  }
  if (/parallax|scroll[- ]?reveal|scroll[- ]?trigger|scrub|pinned|on scroll/.test(blob)) {
    scrollTriggered = true;
  }

  const suggestedLibrary: MotionLibrary = /gsap|greensock/.test(libBlob) ? 'gsap' : 'none';

  const effects = new Set<MotionEffect>(['reveal', 'stagger']);
  if (scrollTriggered || mentions(/parallax/)) effects.add('parallax');
  if (mentions(/marquee|ticker|scrolling text|infinite scroll/)) effects.add('marquee');
  if (mentions(/count[- ]?up|counter|tally|\bstat\b|\bstats\b|number ticks/)) effects.add('count-up');
  if (mentions(/line[- ]?mask|mask reveal|split[- ]?text|headline reveal|oversized (serif )?headline|display headline/)) {
    effects.add('line-mask');
  }
  if (mentions(/blur|defocus|focus[- ]?in|develops|darkroom|resolve on/)) effects.add('blur-in');
  if (mentions(/magnetic|cursor[- ]?follow|pointer[- ]?follow/)) effects.add('magnetic');

  return {
    libraries: [...libraries],
    easings: [...easings],
    keyframeNames: [...keyframeNames],
    scrollTriggered,
    smoothScroll,
    suggestedLibrary,
    suggestedEffects: MOTION_EFFECTS.filter(e => effects.has(e)),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// generateMotionLayer
// ════════════════════════════════════════════════════════════════════════════

export function generateMotionLayer(opts: MotionLayerOptions = {}): MotionLayer {
  const library: MotionLibrary = opts.library ?? opts.detected?.suggestedLibrary ?? 'none';
  const themeTransition: ThemeTransition = opts.themeTransition ?? 'none';
  const smoothScrollRequested = opts.smoothScroll ?? opts.detected?.smoothScroll ?? false;
  const smoothScroll = smoothScrollRequested && library === 'gsap';

  const requested = opts.effects ?? opts.detected?.suggestedEffects ?? ['reveal', 'stagger'];
  let effects = MOTION_EFFECTS.filter(e => requested.includes(e));
  if (effects.length === 0) effects = ['reveal'];

  const css = buildCss(effects, themeTransition, library);
  const js = buildJs(library, effects, smoothScroll, themeTransition);
  const html = buildHtml(effects, library, smoothScroll, themeTransition);
  const notes = buildNotes(library, effects, smoothScroll, smoothScrollRequested, themeTransition);

  return { css, js, html, notes, effects };
}

// ── CSS ─────────────────────────────────────────────────────────────────────

function buildCss(effects: MotionEffect[], theme: ThemeTransition, library: MotionLibrary): string {
  const on = (e: MotionEffect): boolean => effects.includes(e);
  const parts: string[] = [];

  parts.push(
    `/* ============================================================\n` +
    `   DesignScout motion layer — ${library} build\n` +
    `   effects: ${effects.join(', ')}\n` +
    `   At rest every element is fully visible. Resting opacity:0 /\n` +
    `   transforms apply ONLY under html.anim-ready, which the\n` +
    `   controller adds only after it confirms it will animate —\n` +
    `   never under prefers-reduced-motion${library === 'gsap' ? ', never without GSAP' : ''}.\n` +
    `   ============================================================ */`,
  );

  // Structural rules — always on, independent of .anim-ready.
  const structural: string[] = [];
  if (on('marquee')) {
    structural.push(
      `[data-marquee] { display: flex; flex-wrap: nowrap; overflow: hidden; }`,
      `[data-marquee] > * { flex: 0 0 auto; display: flex; flex-wrap: nowrap; min-width: 100%; }`,
    );
  }
  if (on('line-mask')) {
    structural.push(`[data-line-mask] .ds-line { display: block; overflow: hidden; }`);
  }
  if (structural.length) parts.push(`/* structural */\n` + structural.join('\n'));

  // At-rest hidden states, gated behind html.anim-ready.
  const rest: string[] = [];
  if (on('reveal')) {
    rest.push(
      `html.anim-ready [data-reveal] { opacity: 0; transform: translateY(20px); transition: opacity .7s cubic-bezier(.16,1,.3,1), transform .7s cubic-bezier(.16,1,.3,1); }`,
      `html.anim-ready [data-reveal].is-visible { opacity: 1; transform: none; }`,
    );
  }
  if (on('stagger')) {
    rest.push(
      `html.anim-ready [data-stagger] > * { opacity: 0; transform: translateY(16px); transition: opacity .6s cubic-bezier(.16,1,.3,1), transform .6s cubic-bezier(.16,1,.3,1); }`,
      `html.anim-ready [data-stagger].is-visible > * { opacity: 1; transform: none; }`,
    );
  }
  if (on('blur-in')) {
    rest.push(
      `html.anim-ready [data-blur-in] { opacity: 0; filter: blur(12px); transition: opacity .8s ease, filter .8s ease; }`,
      `html.anim-ready [data-blur-in].is-visible { opacity: 1; filter: none; }`,
    );
  }
  if (on('line-mask')) {
    rest.push(
      `html.anim-ready [data-line-mask] .ds-line-inner { display: block; transform: translateY(110%); }`,
      `html.anim-ready [data-line-mask].is-visible .ds-line-inner { transform: none; transition: transform .9s cubic-bezier(.16,1,.3,1); }`,
    );
  }
  if (on('parallax')) {
    rest.push(`html.anim-ready [data-parallax] { will-change: transform; }`);
  }
  if (on('magnetic')) {
    rest.push(`html.anim-ready [data-magnetic] { transition: transform .3s cubic-bezier(.16,1,.3,1); }`);
  }
  if (rest.length) parts.push(`/* at-rest states — gated behind html.anim-ready */\n` + rest.join('\n'));

  if (theme !== 'none') parts.push(themeCss(theme));

  // prefers-reduced-motion kill-switch.
  parts.push(
    `/* reduced-motion kill-switch — nothing hides, nothing moves */\n` +
    `@media (prefers-reduced-motion: reduce) {\n` +
    `  html.anim-ready [data-reveal],\n` +
    `  html.anim-ready [data-stagger] > *,\n` +
    `  html.anim-ready [data-blur-in],\n` +
    `  html.anim-ready [data-line-mask] .ds-line-inner,\n` +
    `  html.anim-ready [data-parallax],\n` +
    `  html.anim-ready [data-magnetic] {\n` +
    `    opacity: 1 !important;\n` +
    `    filter: none !important;\n` +
    `    transform: none !important;\n` +
    `    transition: none !important;\n` +
    `  }\n` +
    `  [data-marquee] > * + * { display: none !important; }\n` +
    `  ::view-transition-group(*),\n` +
    `  ::view-transition-old(*),\n` +
    `  ::view-transition-new(*) { animation: none !important; }\n` +
    `}`,
  );

  return parts.join('\n\n') + '\n';
}

function themeCss(theme: ThemeTransition): string {
  if (theme === 'fade') {
    return (
      `/* theme transition: cross-fade (View Transitions API) */\n` +
      `::view-transition-old(root),\n` +
      `::view-transition-new(root) { animation-duration: .35s; animation-timing-function: ease; }`
    );
  }
  if (theme === 'wipe') {
    return (
      `/* theme transition: top-to-bottom wipe (View Transitions API) */\n` +
      `::view-transition-old(root) { animation: none; }\n` +
      `::view-transition-new(root) { animation: ds-theme-wipe .5s cubic-bezier(.16,1,.3,1); }\n` +
      `@keyframes ds-theme-wipe {\n` +
      `  from { clip-path: inset(0 0 100% 0); }\n` +
      `  to { clip-path: inset(0 0 0 0); }\n` +
      `}`
    );
  }
  // iris
  return (
    `/* theme transition: circular iris from the toggle (View Transitions API) */\n` +
    `::view-transition-old(root) { animation: none; }\n` +
    `::view-transition-new(root) { animation: ds-theme-iris .5s ease; }\n` +
    `@keyframes ds-theme-iris {\n` +
    `  from { clip-path: circle(0 at var(--ds-iris-x, 50%) var(--ds-iris-y, 50%)); }\n` +
    `  to { clip-path: circle(140vmax at var(--ds-iris-x, 50%) var(--ds-iris-y, 50%)); }\n` +
    `}`
  );
}

// ── JS ──────────────────────────────────────────────────────────────────────

function buildJs(
  library: MotionLibrary,
  effects: MotionEffect[],
  smoothScroll: boolean,
  theme: ThemeTransition,
): string {
  const on = (e: MotionEffect): boolean => effects.includes(e);
  const gsap = library === 'gsap';
  const body: string[] = [];

  body.push(`var root = document.documentElement;`);
  body.push(`var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;`);
  if (gsap) body.push(`var hasGsap = !!(window.gsap && window.ScrollTrigger);`);

  body.push(
    `function showAllAtRest() {\n` +
    `  var rest = document.querySelectorAll('[data-reveal],[data-stagger],[data-blur-in],[data-line-mask]');\n` +
    `  Array.prototype.forEach.call(rest, function (el) { el.classList.add('is-visible'); });\n` +
    `  Array.prototype.forEach.call(document.querySelectorAll('[data-count]'), function (el) {\n` +
    `    var target = parseFloat(el.getAttribute('data-count') || '0');\n` +
    `    if (!isNaN(target)) el.textContent = target.toLocaleString();\n` +
    `  });\n` +
    `}`,
  );

  if (theme !== 'none') body.push(themeJs(theme, gsap));

  if (gsap) {
    body.push(`if (reduced || !hasGsap) { showAllAtRest(); return; }`);
    body.push(
      `var gsap = window.gsap;\n` +
      `var ScrollTrigger = window.ScrollTrigger;\n` +
      `gsap.registerPlugin(ScrollTrigger);\n` +
      `root.classList.add('anim-ready');`,
    );
    if (smoothScroll) {
      body.push(
        `/* smooth scroll — Lenis drives ScrollTrigger */\n` +
        `if (typeof window.Lenis === 'function') {\n` +
        `  var lenis = new window.Lenis({ duration: 1.1, smoothWheel: true });\n` +
        `  lenis.on('scroll', ScrollTrigger.update);\n` +
        `  gsap.ticker.add(function (t) { lenis.raf(t * 1000); });\n` +
        `  gsap.ticker.lagSmoothing(0);\n` +
        `  window.__scoutLenis = lenis;\n` +
        `}`,
      );
    }
  } else {
    body.push(`if (reduced) { showAllAtRest(); return; }`);
    body.push(`root.classList.add('anim-ready');`);
  }

  if (on('line-mask')) body.push(LINE_SPLIT_JS);

  if (gsap) {
    if (on('reveal')) body.push(GSAP_REVEAL);
    if (on('stagger')) body.push(GSAP_STAGGER);
    if (on('blur-in')) body.push(GSAP_BLUR);
    if (on('line-mask')) body.push(GSAP_LINEMASK);
    if (on('parallax')) body.push(GSAP_PARALLAX);
    if (on('count-up')) body.push(GSAP_COUNT);
    if (on('marquee')) body.push(GSAP_MARQUEE);
    if (on('magnetic')) body.push(GSAP_MAGNETIC);
    body.push(`ScrollTrigger.refresh();`);
  } else {
    const revealSel = (['reveal', 'stagger', 'blur-in', 'line-mask'] as MotionEffect[])
      .filter(on)
      .map(e => `[data-${e}]`)
      .join(',');
    if (revealSel) body.push(observerJs(revealSel));
    if (on('parallax')) body.push(VANILLA_PARALLAX);
    if (on('count-up')) body.push(VANILLA_COUNT);
    if (on('marquee')) body.push(VANILLA_MARQUEE);
    if (on('magnetic')) body.push(VANILLA_MAGNETIC);
  }

  const indented = body
    .join('\n\n')
    .split('\n')
    .map(line => (line ? '  ' + line : line))
    .join('\n');

  return (
    `/* DesignScout motion controller — generated by scout_motion. Regenerate, don't edit. */\n` +
    `(function () {\n` +
    `  'use strict';\n\n` +
    indented +
    `\n})();\n`
  );
}

function themeJs(theme: ThemeTransition, gsap: boolean): string {
  const iris =
    theme === 'iris'
      ? `      root.style.setProperty('--ds-iris-x', (e.clientX || window.innerWidth / 2) + 'px');\n` +
        `      root.style.setProperty('--ds-iris-y', (e.clientY || 0) + 'px');\n`
      : '';
  const refresh = gsap
    ? `      if (vt && vt.finished) vt.finished.then(function () { window.ScrollTrigger.refresh(); });\n`
    : '';
  return (
    `/* theme toggle — View Transitions API, instant swap where unsupported */\n` +
    `(function () {\n` +
    `  var toggles = document.querySelectorAll('[data-theme-toggle]');\n` +
    `  if (!toggles.length) return;\n` +
    `  function applyTheme() {\n` +
    `    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';\n` +
    `    root.setAttribute('data-theme', next);\n` +
    `  }\n` +
    `  Array.prototype.forEach.call(toggles, function (btn) {\n` +
    `    btn.addEventListener('click', function (e) {\n` +
    iris +
    `      if (reduced || typeof document.startViewTransition !== 'function') { applyTheme(); return; }\n` +
    `      var vt = document.startViewTransition(applyTheme);\n` +
    refresh +
    `    });\n` +
    `  });\n` +
    `})();`
  );
}

const LINE_SPLIT_JS =
  `/* split [data-line-mask] headlines into masked lines */\n` +
  `(function () {\n` +
  `  var heads = document.querySelectorAll('[data-line-mask]');\n` +
  `  Array.prototype.forEach.call(heads, function (el) {\n` +
  `    var raw = (el.textContent || '').replace(/\\s+/g, ' ').trim();\n` +
  `    if (!raw) return;\n` +
  `    el.textContent = '';\n` +
  `    var probes = raw.split(' ').map(function (w) {\n` +
  `      var s = document.createElement('span');\n` +
  `      s.textContent = w + '\\u00a0';\n` +
  `      s.style.display = 'inline-block';\n` +
  `      el.appendChild(s);\n` +
  `      return s;\n` +
  `    });\n` +
  `    var lines = [];\n` +
  `    var current = [];\n` +
  `    var lastTop = null;\n` +
  `    probes.forEach(function (s) {\n` +
  `      var top = s.offsetTop;\n` +
  `      if (lastTop === null) lastTop = top;\n` +
  `      if (Math.abs(top - lastTop) > 1) { lines.push(current); current = []; lastTop = top; }\n` +
  `      current.push(s.textContent);\n` +
  `    });\n` +
  `    if (current.length) lines.push(current);\n` +
  `    el.textContent = '';\n` +
  `    lines.forEach(function (wordList) {\n` +
  `      var mask = document.createElement('span');\n` +
  `      mask.className = 'ds-line';\n` +
  `      var inner = document.createElement('span');\n` +
  `      inner.className = 'ds-line-inner';\n` +
  `      inner.textContent = wordList.join('').trim();\n` +
  `      mask.appendChild(inner);\n` +
  `      el.appendChild(mask);\n` +
  `    });\n` +
  `  });\n` +
  `})();`;

function observerJs(selector: string): string {
  return (
    `/* reveal on scroll — IntersectionObserver toggles .is-visible */\n` +
    `(function () {\n` +
    `  var targets = document.querySelectorAll('${selector}');\n` +
    `  if (!targets.length) return;\n` +
    `  if (!('IntersectionObserver' in window)) {\n` +
    `    Array.prototype.forEach.call(targets, function (el) { el.classList.add('is-visible'); });\n` +
    `    return;\n` +
    `  }\n` +
    `  var io = new IntersectionObserver(function (entries) {\n` +
    `    entries.forEach(function (entry) {\n` +
    `      if (!entry.isIntersecting) return;\n` +
    `      var el = entry.target;\n` +
    `      var base = parseFloat(el.getAttribute('data-delay') || '0') || 0;\n` +
    `      if (el.hasAttribute('data-stagger')) {\n` +
    `        Array.prototype.forEach.call(el.children, function (child, i) {\n` +
    `          child.style.transitionDelay = (base + i * 0.08) + 's';\n` +
    `        });\n` +
    `      }\n` +
    `      if (el.hasAttribute('data-line-mask')) {\n` +
    `        Array.prototype.forEach.call(el.querySelectorAll('.ds-line-inner'), function (inner, i) {\n` +
    `          inner.style.transitionDelay = (base + i * 0.09) + 's';\n` +
    `        });\n` +
    `      }\n` +
    `      el.classList.add('is-visible');\n` +
    `      io.unobserve(el);\n` +
    `    });\n` +
    `  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });\n` +
    `  Array.prototype.forEach.call(targets, function (el) { io.observe(el); });\n` +
    `})();`
  );
}

const VANILLA_PARALLAX =
  `/* parallax — scrubbed translate on [data-parallax] */\n` +
  `(function () {\n` +
  `  var items = Array.prototype.slice.call(document.querySelectorAll('[data-parallax]'));\n` +
  `  if (!items.length) return;\n` +
  `  var ticking = false;\n` +
  `  function update() {\n` +
  `    var vh = window.innerHeight || 1;\n` +
  `    items.forEach(function (el) {\n` +
  `      var rect = el.getBoundingClientRect();\n` +
  `      var progress = (rect.top + rect.height / 2 - vh / 2) / vh;\n` +
  `      var strength = parseFloat(el.getAttribute('data-parallax') || '') || 0.15;\n` +
  `      el.style.transform = 'translate3d(0,' + (progress * strength * -80).toFixed(2) + 'px,0)';\n` +
  `    });\n` +
  `    ticking = false;\n` +
  `  }\n` +
  `  function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }\n` +
  `  window.addEventListener('scroll', onScroll, { passive: true });\n` +
  `  window.addEventListener('resize', onScroll);\n` +
  `  update();\n` +
  `})();`;

const VANILLA_COUNT =
  `/* count-up — rAF tween fired on enter */\n` +
  `(function () {\n` +
  `  var els = Array.prototype.slice.call(document.querySelectorAll('[data-count]'));\n` +
  `  if (!els.length) return;\n` +
  `  function run(el) {\n` +
  `    var target = parseFloat(el.getAttribute('data-count') || '0');\n` +
  `    var dur = parseFloat(el.getAttribute('data-count-duration') || '1600') || 1600;\n` +
  `    var startTs = null;\n` +
  `    function frame(ts) {\n` +
  `      if (startTs === null) startTs = ts;\n` +
  `      var p = Math.min((ts - startTs) / dur, 1);\n` +
  `      var eased = 1 - Math.pow(1 - p, 3);\n` +
  `      el.textContent = Math.round(target * eased).toLocaleString();\n` +
  `      if (p < 1) requestAnimationFrame(frame);\n` +
  `    }\n` +
  `    requestAnimationFrame(frame);\n` +
  `  }\n` +
  `  if (!('IntersectionObserver' in window)) { els.forEach(run); return; }\n` +
  `  var io = new IntersectionObserver(function (entries) {\n` +
  `    entries.forEach(function (e) {\n` +
  `      if (e.isIntersecting) { run(e.target); io.unobserve(e.target); }\n` +
  `    });\n` +
  `  }, { threshold: 0.6 });\n` +
  `  els.forEach(function (el) { io.observe(el); });\n` +
  `})();`;

const VANILLA_MARQUEE =
  `/* marquee — seamless wrap via a cloned track */\n` +
  `(function () {\n` +
  `  var hosts = Array.prototype.slice.call(document.querySelectorAll('[data-marquee]'));\n` +
  `  hosts.forEach(function (host) {\n` +
  `    var track = host.firstElementChild;\n` +
  `    if (!track) return;\n` +
  `    var clone = track.cloneNode(true);\n` +
  `    clone.setAttribute('aria-hidden', 'true');\n` +
  `    host.appendChild(clone);\n` +
  `    var speed = parseFloat(host.getAttribute('data-marquee-speed') || '') || 0.6;\n` +
  `    var offset = 0;\n` +
  `    var last = null;\n` +
  `    function step(ts) {\n` +
  `      if (last === null) last = ts;\n` +
  `      var dt = ts - last;\n` +
  `      last = ts;\n` +
  `      offset -= speed * dt / 16;\n` +
  `      var w = track.getBoundingClientRect().width || 0;\n` +
  `      if (w && -offset >= w) offset += w;\n` +
  `      var tx = 'translateX(' + offset.toFixed(2) + 'px)';\n` +
  `      track.style.transform = tx;\n` +
  `      clone.style.transform = tx;\n` +
  `      requestAnimationFrame(step);\n` +
  `    }\n` +
  `    requestAnimationFrame(step);\n` +
  `  });\n` +
  `})();`;

const VANILLA_MAGNETIC =
  `/* magnetic — pointer-following translate, fine pointers only */\n` +
  `(function () {\n` +
  `  if (!matchMedia('(pointer: fine)').matches) return;\n` +
  `  Array.prototype.forEach.call(document.querySelectorAll('[data-magnetic]'), function (el) {\n` +
  `    var strength = parseFloat(el.getAttribute('data-magnetic') || '') || 0.25;\n` +
  `    el.addEventListener('pointermove', function (e) {\n` +
  `      var r = el.getBoundingClientRect();\n` +
  `      var dx = e.clientX - (r.left + r.width / 2);\n` +
  `      var dy = e.clientY - (r.top + r.height / 2);\n` +
  `      el.style.transform = 'translate(' + (dx * strength).toFixed(1) + 'px,' + (dy * strength * 1.3).toFixed(1) + 'px)';\n` +
  `    });\n` +
  `    el.addEventListener('pointerleave', function () { el.style.transform = ''; });\n` +
  `  });\n` +
  `})();`;

const GSAP_REVEAL =
  `gsap.utils.toArray('[data-reveal]').forEach(function (el) {\n` +
  `  gsap.from(el, {\n` +
  `    opacity: 0, y: 22, duration: 0.9, ease: 'expo.out',\n` +
  `    scrollTrigger: { trigger: el, start: 'top 85%' },\n` +
  `    onComplete: function () { el.classList.add('is-visible'); }\n` +
  `  });\n` +
  `});`;

const GSAP_STAGGER =
  `gsap.utils.toArray('[data-stagger]').forEach(function (el) {\n` +
  `  gsap.from(el.children, {\n` +
  `    opacity: 0, y: 18, duration: 0.7, ease: 'power3.out', stagger: 0.09,\n` +
  `    scrollTrigger: { trigger: el, start: 'top 85%' },\n` +
  `    onComplete: function () { el.classList.add('is-visible'); }\n` +
  `  });\n` +
  `});`;

const GSAP_BLUR =
  `gsap.utils.toArray('[data-blur-in]').forEach(function (el) {\n` +
  `  gsap.from(el, {\n` +
  `    opacity: 0, filter: 'blur(12px)', duration: 1, ease: 'power2.out',\n` +
  `    scrollTrigger: { trigger: el, start: 'top 82%' },\n` +
  `    onComplete: function () { el.classList.add('is-visible'); }\n` +
  `  });\n` +
  `});`;

const GSAP_LINEMASK =
  `gsap.utils.toArray('[data-line-mask]').forEach(function (el) {\n` +
  `  var inners = el.querySelectorAll('.ds-line-inner');\n` +
  `  if (!inners.length) return;\n` +
  `  gsap.from(inners, {\n` +
  `    yPercent: 115, duration: 0.9, ease: 'expo.out', stagger: 0.09,\n` +
  `    scrollTrigger: { trigger: el, start: 'top 85%' },\n` +
  `    onComplete: function () { el.classList.add('is-visible'); }\n` +
  `  });\n` +
  `});`;

const GSAP_PARALLAX =
  `gsap.utils.toArray('[data-parallax]').forEach(function (el) {\n` +
  `  var strength = parseFloat(el.getAttribute('data-parallax') || '') || 0.15;\n` +
  `  gsap.fromTo(el, { yPercent: -strength * 60 }, {\n` +
  `    yPercent: strength * 60, ease: 'none',\n` +
  `    scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true }\n` +
  `  });\n` +
  `});`;

const GSAP_COUNT =
  `gsap.utils.toArray('[data-count]').forEach(function (el) {\n` +
  `  var target = parseFloat(el.getAttribute('data-count') || '0');\n` +
  `  var proxy = { v: 0 };\n` +
  `  gsap.to(proxy, {\n` +
  `    v: target, duration: 1.8, ease: 'power1.out',\n` +
  `    scrollTrigger: { trigger: el, start: 'top 85%' },\n` +
  `    onUpdate: function () { el.textContent = Math.round(proxy.v).toLocaleString(); }\n` +
  `  });\n` +
  `});`;

const GSAP_MARQUEE =
  `gsap.utils.toArray('[data-marquee]').forEach(function (host) {\n` +
  `  var track = host.firstElementChild;\n` +
  `  if (!track) return;\n` +
  `  var clone = track.cloneNode(true);\n` +
  `  clone.setAttribute('aria-hidden', 'true');\n` +
  `  host.appendChild(clone);\n` +
  `  var speed = parseFloat(host.getAttribute('data-marquee-speed') || '') || 0.6;\n` +
  `  gsap.to([track, clone], {\n` +
  `    xPercent: -100, repeat: -1, ease: 'none', duration: 14 / speed,\n` +
  `    modifiers: { xPercent: gsap.utils.wrap(-100, 0) }\n` +
  `  });\n` +
  `});`;

const GSAP_MAGNETIC =
  `if (matchMedia('(pointer: fine)').matches) {\n` +
  `  gsap.utils.toArray('[data-magnetic]').forEach(function (el) {\n` +
  `    var strength = parseFloat(el.getAttribute('data-magnetic') || '') || 0.25;\n` +
  `    el.addEventListener('pointermove', function (e) {\n` +
  `      var r = el.getBoundingClientRect();\n` +
  `      gsap.to(el, {\n` +
  `        x: (e.clientX - (r.left + r.width / 2)) * strength,\n` +
  `        y: (e.clientY - (r.top + r.height / 2)) * strength * 1.3,\n` +
  `        duration: 0.4, ease: 'power3.out'\n` +
  `      });\n` +
  `    });\n` +
  `    el.addEventListener('pointerleave', function () {\n` +
  `      gsap.to(el, { x: 0, y: 0, duration: 0.6, ease: 'elastic.out(1, 0.4)' });\n` +
  `    });\n` +
  `  });\n` +
  `}`;

// ── HTML usage block ────────────────────────────────────────────────────────

function buildHtml(
  effects: MotionEffect[],
  library: MotionLibrary,
  smoothScroll: boolean,
  theme: ThemeTransition,
): string {
  const on = (e: MotionEffect): boolean => effects.includes(e);
  const hooks: string[] = [];
  if (on('reveal')) hooks.push(`  data-reveal                fade + rise in when scrolled into view`);
  if (on('stagger')) hooks.push(`  data-stagger               direct children rise in sequence`);
  if (on('parallax')) hooks.push(`  data-parallax="0.2"        scrubbed vertical parallax (strength optional)`);
  if (on('line-mask')) hooks.push(`  data-line-mask             headline; JS splits it into overflow-masked lines`);
  if (on('count-up')) hooks.push(`  data-count="1200"          counts up to the number on enter`);
  if (on('marquee')) hooks.push(`  data-marquee               seamless infinite marquee (first child is the track)`);
  if (on('magnetic')) hooks.push(`  data-magnetic="0.25"       pointer-following button (fine pointers only)`);
  if (on('blur-in')) hooks.push(`  data-blur-in               blur-to-focus when scrolled into view`);
  if (theme !== 'none') hooks.push(`  data-theme-toggle          button that swaps html[data-theme] with a ${theme} transition`);

  const load: string[] = [`  1. Link motion.css in <head>; load motion.js before </body>.`];
  if (library === 'gsap') {
    load.push(
      `  2. Load GSAP 3 + ScrollTrigger${smoothScroll ? ' + Lenis' : ''} BEFORE motion.js.`,
      `     The controller hard-bails (content stays visible) if window.gsap is absent.`,
    );
  }

  return (
    `<!--\n` +
    `  DesignScout motion layer — usage\n\n` +
    load.join('\n') +
    `\n\n  Hooks:\n` +
    (hooks.length ? hooks.join('\n') : `  (none)`) +
    `\n\n` +
    `  Everything is visible at rest. Nothing is hidden until the controller adds\n` +
    `  html.anim-ready, and it never does that under prefers-reduced-motion` +
    (library === 'gsap' ? ` or when GSAP is missing` : ``) +
    `.\n` +
    `-->\n`
  );
}

// ── notes ───────────────────────────────────────────────────────────────────

function buildNotes(
  library: MotionLibrary,
  effects: MotionEffect[],
  smoothScroll: boolean,
  smoothScrollRequested: boolean,
  theme: ThemeTransition,
): string[] {
  const notes: string[] = [];
  notes.push(`Effects: ${effects.join(', ')}.`);

  if (library === 'gsap') {
    notes.push(
      `GSAP build: load gsap@3 and ScrollTrigger before motion.js. The controller reads ` +
      `window.gsap && window.ScrollTrigger and hard-bails with all content visible if either is missing.`,
    );
    if (smoothScroll) notes.push(`Smooth scroll: also load Lenis before motion.js; it drives ScrollTrigger.update.`);
  } else {
    notes.push(`Vanilla build: zero dependencies — IntersectionObserver + requestAnimationFrame only.`);
    if (smoothScrollRequested && !smoothScroll) {
      notes.push(`smooth_scroll was ignored: the dependency-free build has no smooth-scroll layer. Use library "gsap" for Lenis.`);
    }
  }

  notes.push(
    `prefers-reduced-motion: the controller sets every final state and returns without adding html.anim-ready, ` +
    `so no element is ever left hidden.`,
  );
  notes.push(
    `Resting opacity:0 / transforms are scoped to html.anim-ready, which JS adds only after confirming it will animate. ` +
    `The CSS also carries a @media (prefers-reduced-motion: reduce) kill-switch as a backstop.`,
  );

  if (theme !== 'none') {
    notes.push(
      `Theme transition (${theme}): wired to [data-theme-toggle] via document.startViewTransition, ` +
      `degrading to an instant html[data-theme] swap where the View Transitions API is unavailable or motion is reduced.`,
    );
  }

  return notes;
}
