import type { Confidence, RevenueMethod } from './config';
import type { LeaderRow } from './queries';

/** Pure aggregation helpers (no database, testable). */

const CONF_ORDER: Record<string, number> = { high: 1, medium: 2, low: 3 };

/** Per (app, country) aggregate over the window, as returned by the SQL in queries.ts. */
export interface AggRow {
  app_id: number;
  country: string;
  avg_rev: number;
  avg_lo: number;
  avg_hi: number;
  avg_dl: number | null;
  days: number;
  rec: number | null;
  rec_n: number;
  pri: number | null;
  pri_n: number;
  conf: number;
  method: RevenueMethod;
  calibrated: number;
}

const MIN_GROWTH_DAYS = 3;

export function combine(rows: AggRow[], windowDays: number): Map<number, Omit<LeaderRow, 'name' | 'developer' | 'genreId' | 'genreName' | 'iconUrl' | 'price'>> {
  const byApp = new Map<number, AggRow[]>();
  for (const r of rows) {
    if (!r.days) continue; // only outside the display window
    const list = byApp.get(r.app_id) ?? [];
    list.push(r);
    byApp.set(r.app_id, list);
  }
  const out = new Map();
  for (const [appId, list] of byApp) {
    const daily = list.reduce((s, r) => s + r.avg_rev, 0);
    const lo = list.reduce((s, r) => s + r.avg_lo, 0);
    const hi = list.reduce((s, r) => s + r.avg_hi, 0);
    const dlRows = list.filter((r) => r.avg_dl !== null);
    const dl = dlRows.length ? dlRows.reduce((s, r) => s + (r.avg_dl ?? 0), 0) : null;
    const g = list.filter((r) => r.rec_n >= MIN_GROWTH_DAYS && r.pri_n >= MIN_GROWTH_DAYS);
    const rec = g.reduce((s, r) => s + (r.rec ?? 0), 0);
    const pri = g.reduce((s, r) => s + (r.pri ?? 0), 0);
    const top = [...list].sort((a, b) => b.avg_rev - a.avg_rev)[0];
    out.set(appId, {
      appId,
      dailyRevenue: daily,
      dailyLow: lo,
      dailyHigh: hi,
      monthlyRevenue: daily * 30,
      monthlyLow: lo * 30,
      monthlyHigh: hi * 30,
      dailyDownloads: dl,
      rpd: dl && dl > 0 ? daily / dl : null,
      growth: g.length && pri > 0 ? rec / pri - 1 : null,
      daysObserved: Math.max(...list.map((r) => r.days)),
      windowDays,
      confidence: (Object.keys(CONF_ORDER).find((k) => CONF_ORDER[k] === top.conf) ?? 'low') as Confidence,
      method: top.method,
      calibrated: list.some((r) => r.calibrated === 1),
      countries: list.length,
      topCountry: top.country,
    });
  }
  return out;
}

