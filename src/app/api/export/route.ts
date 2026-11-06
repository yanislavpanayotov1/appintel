import { getLeaderboard, getMeta } from '../../../lib/queries';
import { parseFilter } from '../../../lib/filters';
import { METHOD_LABEL } from '../../../lib/config';

export const dynamic = 'force-dynamic';

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV export of the leaderboard with the same filters as the page (all pages). */
export async function GET(req: Request) {
  const meta = getMeta();
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const f = { ...parseFilter(sp, meta.countries), page: 1, pageSize: 100_000 };
  const { rows } = getLeaderboard(f);
  const header = [
    'app_id', 'name', 'developer', 'category', 'price_usd',
    'revenue_month_usd', 'revenue_month_low', 'revenue_month_high', 'revenue_day_usd',
    'growth_7d', 'downloads_day', 'revenue_per_download', 'confidence', 'method', 'calibrated',
    'days_observed', 'window_days', 'countries', 'top_country', 'data_through',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.appId, r.name, r.developer, r.genreName, r.price,
        r.monthlyRevenue.toFixed(0), r.monthlyLow.toFixed(0), r.monthlyHigh.toFixed(0), r.dailyRevenue.toFixed(2),
        r.growth === null ? '' : r.growth.toFixed(4), r.dailyDownloads === null ? '' : r.dailyDownloads.toFixed(0),
        r.rpd === null ? '' : r.rpd.toFixed(4), r.confidence, METHOD_LABEL[r.method] ?? r.method, r.calibrated,
        r.daysObserved, r.windowDays, r.countries, r.topCountry, meta.latestDate,
      ].map(esc).join(','),
    );
  }
  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="appintel-revenue-${meta.latestDate ?? 'empty'}.csv"`,
    },
  });
}
