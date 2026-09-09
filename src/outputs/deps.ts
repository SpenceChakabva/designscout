/**
 * CDN dependency resolution.
 *
 * Ports the hand-run `curl api.cdnjs.com/libraries/<lib>?fields=version` + jsDelivr
 * `data.jsdelivr.com` dance from the test-scout-v2 build: resolve an exact pinned
 * version and a working `<script src>` URL for each requested library.
 *
 * Known result from that build: GSAP -> 3.13.0 on cdnjs; Lenis absent from cdnjs
 * -> resolved on jsDelivr. Offline -> every lib comes back `unresolved`, never throws.
 */

const USER_AGENT = 'DesignScout/0.2 (+deps)';

export interface DepResolveOptions {
  /** Which CDN to try first. Default 'cdnjs'. */
  prefer?: 'cdnjs' | 'jsdelivr';
}

export interface DepResult {
  /** Canonical library name (the alias target if one applied, else the request). */
  name: string;
  /** Exactly what the caller asked for. */
  requested: string;
  /** Resolved exact version, or null if unresolved. */
  version: string | null;
  source: 'cdnjs' | 'jsdelivr' | 'unresolved';
  /** Ready-to-paste `<script src>` URL, or null. */
  url: string | null;
  notes: string;
}

/**
 * Short, hand-maintained map for libraries whose npm name, cdnjs library name, or
 * file path is not guessable from the request string.
 */
interface Alias {
  /** npm package name (for jsDelivr). */
  pkg: string;
  /** cdnjs library slug, if it is published there. */
  cdnjsLib?: string;
  /** File within the cdnjs version dir, e.g. `gsap.min.js`. */
  cdnjsFile?: string;
  /** File within the npm package for jsDelivr, e.g. `dist/lenis.min.js`. */
  jsdelivrFile?: string;
  note?: string;
}

const ALIASES: Record<string, Alias> = {
  // GSAP: main file is gsap.min.js, not the package-name guess.
  'gsap': {
    pkg: 'gsap',
    cdnjsLib: 'gsap',
    cdnjsFile: 'gsap.min.js',
    jsdelivrFile: 'dist/gsap.min.js',
  },
  // ScrollTrigger ships inside the gsap package (both on cdnjs and npm).
  'gsap/scrolltrigger': {
    pkg: 'gsap',
    cdnjsLib: 'gsap',
    cdnjsFile: 'ScrollTrigger.min.js',
    jsdelivrFile: 'dist/ScrollTrigger.min.js',
    note: 'ScrollTrigger is part of the gsap package',
  },
  'scrolltrigger': {
    pkg: 'gsap',
    cdnjsLib: 'gsap',
    cdnjsFile: 'ScrollTrigger.min.js',
    jsdelivrFile: 'dist/ScrollTrigger.min.js',
    note: 'ScrollTrigger is part of the gsap package',
  },
  // Lenis smooth scroll: not on cdnjs; npm name is now "lenis" (was @studio-freight/lenis).
  'lenis': {
    pkg: 'lenis',
    jsdelivrFile: 'dist/lenis.min.js',
    note: 'Not published to cdnjs; resolved via jsDelivr. Formerly @studio-freight/lenis.',
  },
  '@studio-freight/lenis': {
    pkg: '@studio-freight/lenis',
    jsdelivrFile: 'dist/lenis.min.js',
    note: 'Legacy package name — prefer "lenis".',
  },
};

export async function resolveDeps(
  libs: string[],
  opts: DepResolveOptions = {},
): Promise<DepResult[]> {
  const prefer = opts.prefer ?? 'cdnjs';
  return Promise.all(libs.map(lib => resolveOne(lib, prefer)));
}

async function resolveOne(requested: string, prefer: 'cdnjs' | 'jsdelivr'): Promise<DepResult> {
  const key = requested.trim().toLowerCase();
  const alias = ALIASES[key];
  const pkg = alias?.pkg ?? requested.trim();
  const name = alias ? alias.pkg : requested.trim();
  const notes: string[] = [];
  if (alias?.note) notes.push(alias.note);

  let network = { failed: false };

  const order: Array<'cdnjs' | 'jsdelivr'> = prefer === 'jsdelivr'
    ? ['jsdelivr', 'cdnjs']
    : ['cdnjs', 'jsdelivr'];

  for (const src of order) {
    const result = src === 'cdnjs'
      ? await tryCdnjs(requested, name, alias, network)
      : await tryJsdelivr(requested, name, pkg, alias, network);
    if (result) {
      return { ...result, notes: [...notes, result.notes].filter(Boolean).join(' ') };
    }
  }

  return {
    name,
    requested,
    version: null,
    source: 'unresolved',
    url: null,
    notes: [
      ...notes,
      network.failed ? 'network unavailable' : 'not found on cdnjs or jsDelivr',
    ].join(' '),
  };
}

async function tryCdnjs(
  requested: string,
  name: string,
  alias: Alias | undefined,
  network: { failed: boolean },
): Promise<DepResult | null> {
  const cdnjsLib = alias?.cdnjsLib ?? (requested.includes('/') ? null : requested.trim());
  if (!cdnjsLib) return null;

  const res = await fetchJson(`https://api.cdnjs.com/libraries/${encodeURIComponent(cdnjsLib)}?fields=name,version,latest`);
  if (!res.ok) {
    if (res.network) network.failed = true;
    return null;
  }
  const version: string | undefined = res.data?.version;
  if (!version) return null;

  const url = alias?.cdnjsFile
    ? `https://cdnjs.cloudflare.com/ajax/libs/${cdnjsLib}/${version}/${alias.cdnjsFile}`
    : (typeof res.data?.latest === 'string' ? res.data.latest : null);

  return {
    name,
    requested,
    version,
    source: 'cdnjs',
    url,
    notes: url ? '' : 'cdnjs gave no file URL; adjust the path manually.',
  };
}

async function tryJsdelivr(
  requested: string,
  name: string,
  pkg: string,
  alias: Alias | undefined,
  network: { failed: boolean },
): Promise<DepResult | null> {
  let version: string | undefined;

  const modern = await fetchJson(`https://data.jsdelivr.com/v1/packages/npm/${pkg}`);
  if (modern.ok) {
    version = modern.data?.tags?.latest ?? modern.data?.versions?.[0]?.version;
  } else if (modern.network) {
    network.failed = true;
  }

  if (!version) {
    const legacy = await fetchJson(`https://data.jsdelivr.com/v1/package/npm/${pkg}`);
    if (legacy.ok) {
      version = legacy.data?.tags?.latest ?? legacy.data?.versions?.[0];
    } else if (legacy.network) {
      network.failed = true;
    }
  }

  if (!version) return null;

  const file = alias?.jsdelivrFile ?? `dist/${baseName(pkg)}.min.js`;
  return {
    name,
    requested,
    version,
    source: 'jsdelivr',
    url: `https://cdn.jsdelivr.net/npm/${pkg}@${version}/${file}`,
    notes: alias?.jsdelivrFile
      ? ''
      : 'jsDelivr file path is a best guess — verify /dist/ and the filename.',
  };
}

function baseName(pkg: string): string {
  const seg = pkg.split('/').pop() || pkg;
  return seg.replace(/^@/, '');
}

type JsonResult =
  | { ok: true; data: any }
  | { ok: false; network: boolean; status?: number };

async function fetchJson(url: string): Promise<JsonResult> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
    if (!res.ok) return { ok: false, network: false, status: res.status };
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, network: true };
  }
}
