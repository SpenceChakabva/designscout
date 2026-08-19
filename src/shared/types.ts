// ── Site capture ──

export interface CaptureOptions {
  url: string;
  viewport?: { width: number; height: number };
  scrollDelay?: number;       // ms between scroll steps
  screenshotInterval?: number; // px between captures
  maxScrolls?: number;
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

// ── Design tokens ──

export type TokenFormat = 'json' | 'css' | 'tailwind';

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

export type ComponentType = 'hero' | 'navbar' | 'card' | 'footer' | 'features' | 'testimonials' | 'cta' | 'pricing';
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

// ── Config ──

export interface DesignScoutConfig {
  dataDir: string;
  screenshotsDir: string;
  outputsDir: string;
  defaultViewport: { width: number; height: number };
  defaultScrollDelay: number;
  defaultScreenshotInterval: number;
  maxScrolls: number;
}
