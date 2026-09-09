import fs from 'node:fs';

/**
 * Self-contained / CSP-safe HTML bundling.
 *
 * Ports the behaviour of the hand-written test-scout-v2 scripts embed-images.py
 * and package.py into a real tool: turn a built HTML file's remote image URLs into
 * `data:` URIs and inline allowlisted `<script src>` / `<link rel=stylesheet>` so
 * the file opens with no network and survives a strict (claude.ai-style) sandbox.
 *
 * No DOM library — everything is regex / string scanning, exactly like package.py.
 */

const USER_AGENT = 'DesignScout/0.2 (+bundle)';

/** Hosts we will inline JS / CSS from. Never inline cross-origin scripts/styles otherwise. */
const SCRIPT_STYLE_ALLOWLIST = new Set([
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'code.jquery.com',
  'fonts.googleapis.com',
]);

export interface BundleInput {
  /** Path to a built HTML file. */
  filePath?: string;
  /** Raw HTML string (takes precedence over filePath). */
  html?: string;
  /** Absolute URL the document was served from, used to resolve relative asset refs. */
  baseUrl?: string;
}

export interface BundleOptions {
  /** Fetch remote images and replace with `data:` URIs. Default true. */
  inlineImages?: boolean;
  /** Fetch allowlisted remote JS and inline as `<script>…</script>`. Default false. */
  inlineScripts?: boolean;
  /** Fetch allowlisted remote CSS and inline as `<style>…</style>`. Default false. */
  inlineStyles?: boolean;
  /** Insert `<meta charset>` + viewport when absent. Default true. */
  addMeta?: boolean;
  /** Skip any single asset larger than this many bytes. Default 5 MiB. */
  maxAssetBytes?: number;
}

export type BundleAssetAction = 'inlined' | 'skipped' | 'failed';
export type BundleAssetType = 'image' | 'script' | 'style' | 'font';

export interface BundleAsset {
  url: string;
  type: BundleAssetType;
  bytes: number;
  action: BundleAssetAction;
  reason?: string;
}

export interface BundleResult {
  html: string;
  bytes: number;
  originalBytes: number;
  assets: BundleAsset[];
  warnings: string[];
}

interface Ctx {
  baseUrl?: string;
  maxAssetBytes: number;
  inlineImages: boolean;
  assets: BundleAsset[];
  warnings: string[];
  /** resolvedUrl -> data URI (or null once known-unfetchable) */
  binaryCache: Map<string, string | null>;
  /** resolvedUrl -> text (or null) */
  textCache: Map<string, string | null>;
  /** resolvedUrls already recorded as an asset, so we report each once */
  reported: Set<string>;
}

export async function bundleHtml(
  input: BundleInput,
  opts: BundleOptions = {},
): Promise<BundleResult> {
  const inlineImages = opts.inlineImages ?? true;
  const inlineScripts = opts.inlineScripts ?? false;
  const inlineStyles = opts.inlineStyles ?? false;
  const addMeta = opts.addMeta ?? true;
  const maxAssetBytes = opts.maxAssetBytes ?? 5 * 1024 * 1024;

  let html: string;
  if (typeof input.html === 'string') {
    html = input.html;
  } else if (input.filePath) {
    html = await fs.promises.readFile(input.filePath, 'utf-8');
  } else {
    throw new Error('bundleHtml requires input.html or input.filePath');
  }

  const originalBytes = Buffer.byteLength(html, 'utf-8');

  const ctx: Ctx = {
    baseUrl: input.baseUrl,
    maxAssetBytes,
    inlineImages,
    assets: [],
    warnings: [],
    binaryCache: new Map(),
    textCache: new Map(),
    reported: new Set(),
  };

  if (inlineStyles) html = await inlineStylesheets(html, ctx);
  if (inlineScripts) html = await inlineScriptTags(html, ctx);
  if (inlineImages) html = await inlineImageAssets(html, ctx);
  if (addMeta) html = ensureMeta(html, ctx.warnings);

  return {
    html,
    bytes: Buffer.byteLength(html, 'utf-8'),
    originalBytes,
    assets: ctx.assets,
    warnings: ctx.warnings,
  };
}

// ── <link rel="stylesheet"> ──────────────────────────────────────────────────

async function inlineStylesheets(html: string, ctx: Ctx): Promise<string> {
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    if (!/\brel\s*=\s*(["']?)[^"'>]*stylesheet[^"'>]*\1/i.test(tag)) continue;
    const href = attr(tag, 'href');
    if (!href) continue;
    const resolved = resolveUrl(href, ctx.baseUrl);
    if (!resolved) {
      ctx.warnings.push(`stylesheet not inlined (unresolvable href): ${href}`);
      continue;
    }
    if (!hostAllowed(resolved)) {
      ctx.warnings.push(`stylesheet not inlined (host not in allowlist): ${resolved}`);
      continue;
    }
    const fetched = await fetchText(resolved, ctx);
    if (fetched == null) {
      record(ctx, resolved, 'style', 0, 'failed', 'fetch failed');
      continue;
    }
    let css = fetched.text;
    if (ctx.inlineImages) css = await inlineCssUrls(css, resolved, ctx);
    record(ctx, resolved, 'style', fetched.bytes, 'inlined');
    html = html.replace(tag, `<style>/* ${resolved} */\n${css}\n</style>`);
  }
  return html;
}

// ── <script src> ─────────────────────────────────────────────────────────────

async function inlineScriptTags(html: string, ctx: Ctx): Promise<string> {
  const re = /<script\b([^>]*?)\bsrc\s*=\s*(["'])(.*?)\2([^>]*)>\s*<\/script>/gi;
  const matches = [...html.matchAll(re)];
  for (const m of matches) {
    const full = m[0];
    const src = m[3];
    const type = attr(full, 'type');
    const resolved = resolveUrl(src, ctx.baseUrl);
    if (!resolved) {
      ctx.warnings.push(`script not inlined (unresolvable src): ${src}`);
      continue;
    }
    if (!hostAllowed(resolved)) {
      ctx.warnings.push(`script not inlined (host not in allowlist): ${resolved}`);
      continue;
    }
    const fetched = await fetchText(resolved, ctx);
    if (fetched == null) {
      record(ctx, resolved, 'script', 0, 'failed', 'fetch failed');
      continue;
    }
    if (fetched.bytes > ctx.maxAssetBytes) {
      record(ctx, resolved, 'script', fetched.bytes, 'skipped', `exceeds maxAssetBytes (${fetched.bytes} > ${ctx.maxAssetBytes})`);
      continue;
    }
    record(ctx, resolved, 'script', fetched.bytes, 'inlined');
    const open = type ? `<script type="${type}">` : '<script>';
    html = html.replace(full, `${open}/* ${resolved} */\n${fetched.text}\n</script>`);
  }
  return html;
}

// ── images: <img>, srcset, <source>, poster, CSS url() ───────────────────────

async function inlineImageAssets(html: string, ctx: Ctx): Promise<string> {
  const refs = new Set<string>();

  for (const tag of html.match(/<(?:img|source|video)\b[^>]*>/gi) || []) {
    for (const name of ['src', 'poster']) {
      const v = attr(tag, name);
      if (v) refs.add(v);
    }
    const srcset = attr(tag, 'srcset');
    if (srcset) for (const c of parseSrcset(srcset)) refs.add(c);
  }
  for (const u of collectCssUrls(html)) refs.add(u);

  for (const raw of refs) {
    if (raw.startsWith('data:')) continue;
    const resolved = resolveUrl(raw, ctx.baseUrl);
    if (!resolved) continue;
    const dataUri = await toDataUri(resolved, ctx, guessType(resolved));
    if (dataUri) html = splitJoin(html, raw, dataUri);
  }
  return html;
}

/** Rewrite url(...) refs inside a fetched stylesheet, resolving against the sheet's URL. */
async function inlineCssUrls(css: string, cssUrl: string, ctx: Ctx): Promise<string> {
  for (const raw of new Set(collectCssUrls(css))) {
    if (raw.startsWith('data:')) continue;
    const resolved = resolveUrl(raw, cssUrl);
    if (!resolved) continue;
    const dataUri = await toDataUri(resolved, ctx, guessType(resolved));
    if (dataUri) css = splitJoin(css, raw, dataUri);
  }
  return css;
}

// ── <meta> ───────────────────────────────────────────────────────────────────

function ensureMeta(html: string, warnings: string[]): string {
  const hasCharset =
    /<meta[^>]+charset/i.test(html) ||
    /<meta[^>]+http-equiv\s*=\s*["']?content-type/i.test(html);
  const hasViewport = /<meta[^>]+name\s*=\s*["']?viewport["']?/i.test(html);

  const toAdd: string[] = [];
  if (!hasCharset) toAdd.push('<meta charset="utf-8">');
  if (!hasViewport) toAdd.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  if (toAdd.length === 0) return html;

  const headOpen = html.match(/<head\b[^>]*>/i);
  if (headOpen) {
    const at = headOpen.index! + headOpen[0].length;
    return html.slice(0, at) + '\n  ' + toAdd.join('\n  ') + html.slice(at);
  }
  const htmlOpen = html.match(/<html\b[^>]*>/i);
  if (htmlOpen) {
    const at = htmlOpen.index! + htmlOpen[0].length;
    return html.slice(0, at) + `\n<head>\n  ${toAdd.join('\n  ')}\n</head>` + html.slice(at);
  }
  warnings.push('no <head> or <html> element found; meta tags prepended to document');
  return toAdd.join('\n') + '\n' + html;
}

// ── fetching ─────────────────────────────────────────────────────────────────

async function toDataUri(resolved: string, ctx: Ctx, type: BundleAssetType): Promise<string | null> {
  if (ctx.binaryCache.has(resolved)) return ctx.binaryCache.get(resolved) ?? null;

  const res = await fetchBinary(resolved, ctx.maxAssetBytes);
  if (res.ok) {
    const uri = `data:${res.mime};base64,${res.buffer.toString('base64')}`;
    ctx.binaryCache.set(resolved, uri);
    record(ctx, resolved, type, res.buffer.length, 'inlined');
    return uri;
  }
  ctx.binaryCache.set(resolved, null);
  if (res.oversize) {
    record(ctx, resolved, type, res.bytes ?? 0, 'skipped', res.reason);
  } else {
    record(ctx, resolved, type, 0, 'failed', res.reason);
  }
  return null;
}

type BinaryResult =
  | { ok: true; buffer: Buffer; mime: string }
  | { ok: false; oversize?: boolean; bytes?: number; reason: string };

async function fetchBinary(url: string, maxBytes: number): Promise<BinaryResult> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const declared = Number(res.headers.get('content-length') || '');
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { ok: false, oversize: true, bytes: declared, reason: `exceeds maxAssetBytes (${declared} > ${maxBytes})` };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) {
      return { ok: false, oversize: true, bytes: buffer.length, reason: `exceeds maxAssetBytes (${buffer.length} > ${maxBytes})` };
    }
    const mime = (res.headers.get('content-type') || '').split(';')[0].trim() || guessMime(url);
    return { ok: true, buffer, mime };
  } catch (err) {
    return { ok: false, reason: `fetch failed: ${(err as Error).message}` };
  }
}

async function fetchText(url: string, ctx: Ctx): Promise<{ text: string; bytes: number } | null> {
  if (ctx.textCache.has(url)) {
    const cached = ctx.textCache.get(url);
    return cached == null ? null : { text: cached, bytes: Buffer.byteLength(cached, 'utf-8') };
  }
  try {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
    if (!res.ok) {
      ctx.textCache.set(url, null);
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const text = buffer.toString('utf-8');
    ctx.textCache.set(url, text);
    return { text, bytes: buffer.length };
  } catch {
    ctx.textCache.set(url, null);
    return null;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function record(
  ctx: Ctx,
  url: string,
  type: BundleAssetType,
  bytes: number,
  action: BundleAssetAction,
  reason?: string,
): void {
  if (ctx.reported.has(url)) return;
  ctx.reported.add(url);
  ctx.assets.push(reason ? { url, type, bytes, action, reason } : { url, type, bytes, action });
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
  if (!m) return undefined;
  return m[2] ?? m[3] ?? m[4];
}

function parseSrcset(value: string): string[] {
  return value
    .split(',')
    .map(part => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function collectCssUrls(text: string): string[] {
  const out: string[] = [];
  const re = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const u = m[2].trim();
    if (u) out.push(u);
  }
  return out;
}

function resolveUrl(raw: string, baseUrl?: string): string | null {
  const trimmed = raw.trim().replace(/&amp;/g, '&');
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('#')) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return 'https:' + trimmed;
  if (!baseUrl) return null;
  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return null;
  }
}

function hostAllowed(url: string): boolean {
  try {
    return SCRIPT_STYLE_ALLOWLIST.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function splitJoin(haystack: string, find: string, replaceWith: string): string {
  if (!find) return haystack;
  const variants = new Set([find, find.replace(/&/g, '&amp;')]);
  for (const v of variants) haystack = haystack.split(v).join(replaceWith);
  return haystack;
}

function guessType(url: string): BundleAssetType {
  return /\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(url) ? 'font' : 'image';
}

function guessMime(url: string): string {
  const ext = (url.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp',
    ico: 'image/x-icon',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    eot: 'application/vnd.ms-fontobject',
    mp4: 'video/mp4', webm: 'video/webm',
  };
  return map[ext] || 'application/octet-stream';
}
