import type { DB } from './db';
import { addPoint } from './model/calibrate';

/**
 * TrustMRR publishes payment-provider-verified revenue at
 * https://trustmrr.com/startup/<slug>.md, including a "Daily revenue — last 30 days"
 * table and, for mobile apps, an App Store link.
 */
export interface TrustMrrProfile {
  name: string;
  appId: number | null;
  daily: { date: string; revenue: number }[];
  revenueType: 'gross' | 'proceeds';
}

export function parseTrustMrrMarkdown(md: string): TrustMrrProfile {
  const name = md.match(/^# (.+)$/m)?.[1]?.trim() ?? 'unknown';
  const idMatch = md.match(/apps\.apple\.com\/[^\s)]*?id(\d{6,})/);
  const section = md.split(/###\s+Daily revenue/i)[1]?.split(/\n#{2,3}\s/)[0] ?? '';
  const daily: { date: string; revenue: number }[] = [];
  for (const m of section.matchAll(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*\$?([\d,]+(?:\.\d+)?)\s*\|/gm)) {
    daily.push({ date: m[1], revenue: Number(m[2].replace(/,/g, '')) });
  }
  // TrustMRR states "Apple revenue is before commission" for App Store connections.
  const proceeds = /after (apple'?s )?commission|net of (store )?fees/i.test(md) && !/before commission/i.test(md);
  return { name, appId: idMatch ? Number(idMatch[1]) : null, daily, revenueType: proceeds ? 'proceeds' : 'gross' };
}

export interface ImportResult {
  id: number;
  name: string;
  appId: number;
  total: number;
  start: string;
  end: string;
  revenueType: 'gross' | 'proceeds';
}

export async function importTrustMrr(
  db: DB,
  slugOrUrl: string,
  opts: { appId?: number; revenueType?: 'gross' | 'proceeds' } = {},
): Promise<ImportResult> {
  const slug = slugOrUrl.trim().replace(/^https?:\/\/(www\.)?trustmrr\.com\/startup\//, '').replace(/\.md$/, '').replace(/[/?#].*$/, '');
  if (!/^[a-z0-9-]+$/i.test(slug)) throw new Error('Not a valid TrustMRR slug');
  const url = `https://trustmrr.com/startup/${slug}.md`;
  const res = await fetch(url, { headers: { accept: 'text/markdown,text/plain', 'user-agent': 'appintel/0.1' } });
  if (!res.ok) throw new Error(`TrustMRR returned HTTP ${res.status} for ${slug}`);
  const profile = parseTrustMrrMarkdown(await res.text());
  const appId = opts.appId ?? profile.appId;
  if (!appId) throw new Error('The profile has no App Store link; enter the App Store id');
  if (!profile.daily.length) throw new Error('No daily revenue table on the profile');
  const dates = profile.daily.map((d) => d.date).sort();
  const total = Math.round(profile.daily.reduce((s, d) => s + d.revenue, 0) * 100) / 100;
  if (!(total > 0)) throw new Error(`${profile.name} shows $0 for ${dates[0]} – ${dates.at(-1)}; nothing to calibrate against`);
  const source = `trustmrr:${slug}`;
  const start = dates[0];
  const end = dates.at(-1)!;
  db.prepare('DELETE FROM calibration_points WHERE source = ? AND period_start = ? AND period_end = ?').run(source, start, end);
  const revenueType = opts.revenueType ?? profile.revenueType;
  const id = addPoint(db, {
    app_id: appId,
    country: 'ww',
    period_start: start,
    period_end: end,
    revenue_usd: total,
    revenue_type: revenueType,
    source,
    note: `${profile.name} — verified revenue, ${url}`,
  });
  return { id, name: profile.name, appId, total, start, end, revenueType };
}
