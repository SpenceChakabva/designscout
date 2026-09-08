// ── Site capture ──

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

export interface Viewport {
  width: number;
  height: number;
}

export interface NamedViewport extends Viewport {
  label: string;
  device: DeviceType;
}

export interface CaptureOptions {
  url: string;
  viewport?: Viewport;
  /** One or more named viewports for a responsive capture. Overrides `viewport`. */
  viewports?: NamedViewport[];
  /** Capture only the element(s) matching this CSS selector. */
  selector?: string;
  scrollDelay?: number;       // ms between scroll steps
  screenshotInterval?: number; // px between captures
  maxScrolls?: number;
  /** Number of navigation attempts before giving up. */
  retries?: number;
  /** Try to dismiss cookie / consent banners before capturing. */
  dismissBanners?: boolean;
}

export interface CapturedSite {
  id: string;
  url: string;
  title: string;
  capturedAt: string;
  viewport: string;
  screenshots: CapturedScreenshot[];
  metadata?: Record<string, unknown>;
}

export interface CapturedScreenshot {
  id: string;
  siteId: string;
  scrollPosition: number;
  filepath: string;
  sectionLabel?: string;
  width: number;
  height: number;
  deviceType?: DeviceType;
  viewportLabel?: string;
}

/** A layout problem detected at a given viewport. */
export interface LayoutIssue {
  viewportLabel: string;
  device: DeviceType;
  type:
    | 'horizontal-scroll'
    | 'element-overflow'
    | 'tiny-tap-target'
    | 'text-too-small'
    | 'fixed-overlap'
    | 'content-clipped';
  detail: string;
  selector?: string;
}

// ── Vision analysis ──

export interface DesignAnalysis {
  sectionType: string;
  colors: ColorPalette;
  typography: TypographyAnalysis;
  layout: LayoutAnalysis;
  components: ComponentAnalysis[];
  mood: string;
  signatureElement: string;
}

export interface ColorPalette {
  background: string;
  primary: string;
  secondary: string;
  accent: string;
  textPrimary: string;
  textSecondary: string;
  [key: string]: string;
}

export interface TypographyAnalysis {
  headingStyle: 'serif' | 'sans' | 'mono' | 'display';
  headingWeight: 'light' | 'regular' | 'bold' | 'black';
  bodyStyle: 'serif' | 'sans' | 'mono';
  estimatedScaleRatio: number;
  notable: string;
}

export interface LayoutAnalysis {
  structure: 'centered' | 'split' | 'grid' | 'asymmetric' | 'full-bleed';
  columns: number;
  spacingDensity: 'tight' | 'comfortable' | 'spacious';
  maxWidth: 'narrow' | 'medium' | 'wide' | 'full';
}

export interface ComponentAnalysis {
  type: string;
  styleNotes: string;
}

// ── Patterns (stored) ──

export interface DesignPattern {
  id: string;
  siteId: string;
  category: 'color' | 'typography' | 'layout' | 'component' | 'spacing' | 'mood';
  subcategory?: string;
  data: Record<string, any>;
  description: string;
  confidence: number;
}

// ── Component inventory (from the live DOM) ──

export interface ComponentInventoryItem {
  type: string;              // button, card, input, badge, link, nav, ...
  variant: string;           // primary, secondary, ghost, outline, ...
  count: number;
  example: string;           // trimmed outerHTML
  styles: Record<string, string>; // key computed styles
}

export interface ComponentInventory {
  siteId: string;
  items: ComponentInventoryItem[];
  generatedAt: string;
}

// ── Accessibility ──

export interface AccessibilityIssue {
  rule: string;
  severity: 'error' | 'warning' | 'advisory';
  detail: string;
  count: number;
  selectorSample?: string[];
}

export interface AccessibilityReport {
  siteId: string;
  score: number;             // 0-100
  issues: AccessibilityIssue[];
  headingOutline: { level: number; text: string }[];
  landmarks: string[];
  generatedAt: string;
}

// ── Design tokens ──

export type TokenFormat = 'json' | 'css' | 'tailwind' | 'style-dictionary' | 'w3c' | 'figma';

export interface DesignTokenSet {
  id: string;
  siteId?: string;
  colors: Record<string, string>;
  typography: {
    fontFamilies: Record<string, string>;
    fontSizes: Record<string, string>;
    fontWeights: Record<string, number>;
    lineHeights: Record<string, string>;
  };
  spacing: Record<string, string>;
  borderRadius: Record<string, string>;
  shadows: Record<string, string>;
  breakpoints: Record<string, string>;
}

// ── Mood board ──

export interface MoodBoardEntry {
  siteUrl: string;
  siteTitle: string;
  screenshotPaths: string[];
  analysis: DesignAnalysis;
  tokens?: DesignTokenSet;
}

export interface MoodBoard {
  title: string;
  brief?: string;
  entries: MoodBoardEntry[];
  generatedAt: string;
}

// ── Code generation ──

export type ComponentType =
  | 'hero'
  | 'navbar'
  | 'card'
  | 'footer'
  | 'features'
  | 'testimonials'
  | 'cta'
  | 'pricing';
export type Framework = 'react' | 'html';

export interface CodegenRequest {
  componentType: ComponentType;
  framework: Framework;
  tokens: DesignTokenSet;
  inspirationPatterns: DesignPattern[];
  brief?: string;
}

export interface CodegenResult {
  componentType: ComponentType;
  framework: Framework;
  code: string;
  filename: string;
  dependencies?: string[];
}

// ── Multi-page crawl ──

export interface CrawlOptions {
  startUrl: string;
  maxPages?: number;
  maxDepth?: number;
  sameOriginOnly?: boolean;
  viewport?: Viewport;
  includePattern?: string;   // regex string — only crawl matching paths
  excludePattern?: string;   // regex string — skip matching paths
}

export interface CrawlPage {
  siteId: string;
  url: string;
  path: string;
  depth: number;
  title: string;
  fingerprint: string;       // structural hash for near-duplicate detection
  duplicateOf?: string;      // url of the page this one mirrors
  screenshot?: string;       // full-page screenshot path
  signals?: PageDesignSignals; // raw design signals for the consistency report
}

/** Lightweight per-page design signals gathered during a crawl. */
export interface PageDesignSignals {
  colors: string[];
  backgrounds: string[];
  fontFamilies: string[];
  fontSizes: string[];
  borderRadii: string[];
  maxWidths: string[];
  headingFont: string;
  bodyFont: string;
  h1Count: number;
  navSignature: string;
  footerSignature: string;
}

export interface CrawlResult {
  id: string;
  startUrl: string;
  pages: CrawlPage[];
  skipped: { url: string; reason: string }[];
  generatedAt: string;
}

// ── Consistency report ──

export interface ConsistencyFinding {
  category: 'color' | 'typography' | 'spacing' | 'component' | 'layout';
  severity: 'error' | 'warning' | 'advisory';
  detail: string;
  pages: string[];
}

export interface ConsistencyReport {
  crawlId: string;
  pageCount: number;
  score: number;             // 0-100, higher = more consistent
  findings: ConsistencyFinding[];
  tokensByPage: Record<string, Partial<DesignTokenSet>>;
  generatedAt: string;
}

// ── Config ──

export interface DesignScoutConfig {
  dataDir: string;
  screenshotsDir: string;
  outputsDir: string;
  defaultViewport: Viewport;
  defaultScrollDelay: number;
  defaultScreenshotInterval: number;
  maxScrolls: number;
  captureRetries: number;
  navTimeoutMs: number;
  crawlMaxPages: number;
  crawlMaxDepth: number;
  viewportPresets: Record<DeviceType, NamedViewport>;
}
