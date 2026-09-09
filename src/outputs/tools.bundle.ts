import fs from 'node:fs';
import path from 'node:path';
import type { DesignScoutConfig } from '../shared/types.js';
import { bundleHtml, type BundleAsset } from './bundle.js';
import { resolveDeps } from './deps.js';

// All tools return plain text — no base64 images over stdio.
type ToolResult = { content: { type: 'text'; text: string }[] };

function textResult(data: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

// ════════════════════════════════════════════════════════════════════════════
// scout_bundle
// ════════════════════════════════════════════════════════════════════════════

export async function handleBundle(
  args: {
    file_path?: string;
    html?: string;
    base_url?: string;
    inline_images?: boolean;
    inline_scripts?: boolean;
    inline_styles?: boolean;
    add_meta?: boolean;
    output_path?: string;
    max_asset_bytes?: number;
  },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  if (!args.file_path && !args.html) {
    return textResult({ success: false, error: 'Provide file_path or html.' });
  }

  let result;
  try {
    result = await bundleHtml(
      { filePath: args.file_path, html: args.html, baseUrl: args.base_url },
      {
        inlineImages: args.inline_images ?? true,
        inlineScripts: args.inline_scripts ?? false,
        inlineStyles: args.inline_styles ?? false,
        addMeta: args.add_meta ?? true,
        maxAssetBytes: args.max_asset_bytes,
      },
    );
  } catch (err) {
    return textResult({ success: false, error: `Bundle failed: ${(err as Error).message}` });
  }

  const outputPath = args.output_path || defaultOutputPath(config, args.file_path);
  let written: string | undefined;
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, result.html, 'utf-8');
    written = outputPath;
  } catch (err) {
    return textResult({
      success: true,
      outputPath: null,
      writeError: `Could not write to ${outputPath}: ${(err as Error).message}`,
      html: result.html,
      ...summarize(result.assets),
      bytes: result.bytes,
      originalBytes: result.originalBytes,
      warnings: result.warnings,
      message: `Bundled inline (write failed). ${humanKb(result.bytes)}, ${countLine(result.assets)}.`,
    });
  }

  const counts = summarize(result.assets);
  return textResult({
    success: true,
    outputPath: written,
    bytes: result.bytes,
    originalBytes: result.originalBytes,
    sizeDelta: result.bytes - result.originalBytes,
    ...counts,
    assets: result.assets,
    warnings: result.warnings,
    message:
      `Wrote ${written} — ${humanKb(result.bytes)} (was ${humanKb(result.originalBytes)}). ` +
      `${countLine(result.assets)}.` +
      (result.warnings.length ? ` ${result.warnings.length} warning(s).` : ''),
  });
}

// ════════════════════════════════════════════════════════════════════════════
// scout_deps
// ════════════════════════════════════════════════════════════════════════════

export async function handleDeps(
  args: { libraries: string[]; prefer?: 'cdnjs' | 'jsdelivr' },
  _config: DesignScoutConfig,
): Promise<ToolResult> {
  const libs = (args.libraries || []).map(s => String(s).trim()).filter(Boolean);
  if (libs.length === 0) {
    return textResult({ success: false, error: 'Provide a non-empty libraries array.' });
  }

  const results = await resolveDeps(libs, { prefer: args.prefer });
  const resolved = results.filter(r => r.source !== 'unresolved');

  return textResult({
    success: true,
    resolvedCount: resolved.length,
    total: results.length,
    dependencies: results,
    message: results
      .map(r => `${r.requested}: ${r.version ? `${r.version} (${r.source})` : 'unresolved'}`)
      .join('; '),
  });
}

// ── helpers ──

function defaultOutputPath(config: DesignScoutConfig, filePath?: string): string {
  const base = filePath ? path.basename(filePath).replace(/\.[^.]+$/, '') : 'bundle';
  return path.join(config.outputsDir, `${base}.bundled.html`);
}

function summarize(assets: BundleAsset[]): {
  assetCounts: { inlined: number; skipped: number; failed: number; total: number };
} {
  return {
    assetCounts: {
      inlined: assets.filter(a => a.action === 'inlined').length,
      skipped: assets.filter(a => a.action === 'skipped').length,
      failed: assets.filter(a => a.action === 'failed').length,
      total: assets.length,
    },
  };
}

function countLine(assets: BundleAsset[]): string {
  const c = summarize(assets).assetCounts;
  return `${c.inlined} inlined, ${c.skipped} skipped, ${c.failed} failed`;
}

function humanKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}
