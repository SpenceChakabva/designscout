import type { DesignScoutConfig } from '../shared/types.js';
import { getDb } from '../store/db.js';
import * as queries from '../store/queries.js';
import { buildPreGenChecklist } from './checklist.js';

type ToolResult = { content: { type: 'text'; text: string }[] };

function textResult(data: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export async function handleChecklist(
  args: { site_id?: string; url?: string },
  config: DesignScoutConfig,
): Promise<ToolResult> {
  const db = getDb(config);
  const site = queries.resolveSite(db, args);
  if (!site) {
    return textResult({
      success: false,
      error: 'Provide a valid site_id or url of a captured site. Run scout_capture first.',
    });
  }

  const meta = (site.metadata || {}) as any;
  const patterns = queries.getPatternsForSite(db, site.id);
  const checklist = buildPreGenChecklist(site.url, meta.extraction, patterns, meta.htmlPath);

  return textResult({
    success: true,
    siteId: site.id,
    url: site.url,
    checklist: checklist.items,
    summary: checklist.summary,
    message:
      'Walk the user through each decision, then proceed to scout_styles / scout_codegen / scout_motion. ' +
      'This is the pre-generation gate from the v0.2 feedback — do not default to desktop-only + static.',
  });
}
