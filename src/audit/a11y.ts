import type { AccessibilityReport, AccessibilityIssue } from '../shared/types.js';
import type { RawA11y } from '../browser/extract.js';

const WEIGHT: Record<AccessibilityIssue['severity'], number> = {
  error: 12,
  warning: 5,
  advisory: 2,
};

/**
 * Turn a raw in-page accessibility scan into a scored report.
 * Deterministic — no axe-core, no network.
 */
export function buildAccessibilityReport(siteId: string, raw: RawA11y): AccessibilityReport {
  const issues: AccessibilityIssue[] = raw.issues.map(i => ({
    rule: i.rule,
    severity: i.severity,
    detail: i.detail,
    count: i.count,
    selectorSample: i.selectorSample,
  }));

  let penalty = 0;
  for (const issue of issues) {
    // Diminishing returns: repeated instances of the same rule hurt less each time.
    penalty += WEIGHT[issue.severity] * (1 + Math.log2(Math.max(1, issue.count)));
  }
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  return {
    siteId,
    score,
    issues: issues.sort((a, b) => WEIGHT[b.severity] - WEIGHT[a.severity] || b.count - a.count),
    headingOutline: raw.headingOutline,
    landmarks: raw.landmarks,
    generatedAt: new Date().toISOString(),
  };
}

export function summarizeA11y(report: AccessibilityReport): string {
  const errors = report.issues.filter(i => i.severity === 'error').length;
  const warnings = report.issues.filter(i => i.severity === 'warning').length;
  if (report.issues.length === 0) return `Accessibility score ${report.score}/100 — no deterministic issues found.`;
  return `Accessibility score ${report.score}/100 — ${errors} error type(s), ${warnings} warning type(s). ` +
    `Landmarks: ${report.landmarks.join(', ') || 'none'}.`;
}
