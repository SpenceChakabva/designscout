/**
 * scout_verify handler — renders *generated* output and checks it.
 *
 * New file. server.ts imports handleVerify from here (no edit to tools.ts).
 */

import fs from 'node:fs';
import type { DesignScoutConfig, NamedViewport } from '../shared/types.js';
import { resolveViewport } from '../shared/config.js';
import { verifyOutput } from '../browser/verify.js';

type ToolResult = { content: { type: 'text'; text: string }[] };

function textResult(data: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export async function handleVerify(
  args: { file_path?: string; html?: string; url?: string; viewports?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  if (!args.file_path && !args.html && !args.url) {
    return textResult({
      success: false,
      error: 'Provide one of file_path (a local .html file), html (a raw HTML string), or url.',
    });
  }

  if (args.file_path && !fs.existsSync(args.file_path)) {
    return textResult({ success: false, error: `File not found: ${args.file_path}` });
  }

  let viewports: NamedViewport[] | undefined;
  if (args.viewports) {
    viewports = args.viewports.split(',').map(s => resolveViewport(s.trim())).filter(Boolean);
    if (viewports.length === 0) viewports = undefined;
  }

  let report;
  try {
    report = await verifyOutput(
      { filePath: args.file_path, html: args.html, url: args.url, viewports },
      config,
    );
  } catch (err) {
    return textResult({ success: false, error: `Verification failed: ${(err as Error).message}` });
  }

  const s = report.summary;
  const problems: string[] = [];
  if (s.horizontalScrollViewports.length) problems.push(`horizontal scroll at ${s.horizontalScrollViewports.join(', ')}`);
  if (s.missingViewportMeta) problems.push('no viewport meta');
  if (s.missingLang) problems.push('no <html lang>');
  if (s.missingCharset) problems.push('no charset meta');
  if (s.failedImages) problems.push(`${s.failedImages} broken image(s)`);
  if (s.consoleErrors) problems.push(`${s.consoleErrors} console error(s)`);
  if (s.pageErrors) problems.push(`${s.pageErrors} uncaught exception(s)`);
  if (s.failedSubresources) problems.push(`${s.failedSubresources} failed subresource(s)`);
  if (s.syntaxErrors) problems.push(`${s.syntaxErrors} inline-script syntax error(s)`);
  if (s.tapTargetIssues) problems.push(`${s.tapTargetIssues} small tap target(s)`);
  if (s.smallTextNodes) problems.push(`${s.smallTextNodes} sub-12px text node(s)`);
  if (s.tellFindings) problems.push(`${s.tellFindings} AI design-tell finding(s)`);

  const message = report.ok
    ? `PASS — rendered clean across ${s.viewports} viewport(s)${problems.length ? ` (advisory: ${problems.join('; ')})` : ''}.`
    : `FAIL — ${problems.join('; ')}.`;

  return textResult({
    success: true,
    ok: report.ok,
    target: report.target,
    summary: report.summary,
    viewportResults: report.viewportResults,
    global: report.global,
    syntaxErrors: report.syntaxErrors,
    tellFindings: report.tellFindings.map(f => ({
      rule: f.ruleId, category: f.category, severity: f.severity, name: f.name, description: f.description, fix: f.fix,
    })),
    message,
  });
}
