import type { DB } from '../db';
import {
  CHART_TYPES,
  OVERALL,
  MODEL_VERSION,
  DEFAULT_BAND,
  METHOD_CONFIDENCE,
  RPD_PRIOR_BY_GENRE,
  DEFAULT_RPD,
  type ChartType,
  type Confidence,
  type RevenueMethod,
} from '../config';
import { fitRankMap, pooledBeta, equivalentRank, type RankMap, type Pair } from './rankmap';
import { powerLaw } from './math';
import { resolveCurve, type ResolvedCurve } from './params';

interface RankRow {
  chart: ChartType;
  genre_id: number;
  rank: number;
  app_id: number;
}

export interface AppEstimate {
  appId: number;
  revenue: number | null;
  revenueLow: number | null;
  revenueHigh: number | null;
  method: RevenueMethod | null;
  confidence: Confidence | null;
  grossingEqRank: number | null;
  downloads: number | null;
  downloadsEqRank: number | null;
  downloadsChart: ChartType | null;
  calibrated: boolean;
}

/** Equivalent overall rank per app for one chart on one day/country. */
export function equivalentRanksForChart(
  rows: RankRow[],
  /** maps from another chart (top grossing) used when a category has no overlap here */
  fallbackMaps?: Map<number, RankMap>,
): { eq: Map<number, { rank: number; source: 'overall' | 'category' }>; maps: Map<number, RankMap> } {
  const overall = new Map<number, number>();
  const byGenre = new Map<number, RankRow[]>();
  for (const r of rows) {
    if (r.genre_id === OVERALL) overall.set(r.app_id, r.rank);
    else {
      if (!byGenre.has(r.genre_id)) byGenre.set(r.genre_id, []);
      byGenre.get(r.genre_id)!.push(r);
    }
  }
  const overallSize = overall.size;

  // First pass: fit genres with enough overlap, then pool their slope for the rest.
  const pairsByGenre = new Map<number, Pair[]>();
  for (const [g, list] of byGenre) {
    const pairs: Pair[] = [];
    for (const r of list) {
      const o = overall.get(r.app_id);
      if (o !== undefined) pairs.push({ categoryRank: r.rank, overallRank: o });
    }
    pairsByGenre.set(g, pairs);
  }
  const firstPass = [...pairsByGenre.values()].map((p) => fitRankMap(p));
  const beta = pooledBeta(firstPass);
  const maps = new Map<number, RankMap>();
  for (const [g, pairs] of pairsByGenre) {
    let m = fitRankMap(pairs, beta);
    const fb = fallbackMaps?.get(g);
    // Some categories never appear in an overall chart (e.g. Games in US top free).
    // Then the same category's top-grossing map is a better proxy for its strength than a fixed anchor.
    if (m.method === 'unmapped' && fb && fb.method !== 'unmapped' && fb.method !== 'borrowed') {
      m = { alpha: fb.alpha, beta: fb.beta, n: fb.n, method: 'borrowed' };
    }
    maps.set(g, m);
  }

  const eq = new Map<number, { rank: number; source: 'overall' | 'category' }>();
  for (const [appId, rank] of overall) eq.set(appId, { rank, source: 'overall' });
  for (const [g, list] of byGenre) {
    const map = maps.get(g)!;
    for (const r of list) {
      if (overall.has(r.app_id)) continue;
      const e = equivalentRank(map, r.rank, overallSize);
      const prev = eq.get(r.app_id);
      // An app can chart in several categories; keep the strongest signal.
      if (!prev || e < prev.rank) eq.set(r.app_id, { rank: e, source: 'category' });
    }
  }
  return { eq, maps };
}

function band(confidence: Confidence, curve: ResolvedCurve): number {
  if (curve.calibrated && curve.logRmse !== null && curve.nPoints >= 3) {
    // One residual std, widened for the weaker methods, never tighter than ×1.3.
    const widen = confidence === 'high' ? 1 : confidence === 'medium' ? 1.25 : 1.6;
    return Math.max(1.3, Math.exp(curve.logRmse) * widen);
  }
  return DEFAULT_BAND[confidence];
}

/** Compute and persist estimates (and the day's rank maps) for one date & country. */
export function estimateDay(db: DB, date: string, country: string): AppEstimate[] {
  const rows = db
    .prepare('SELECT chart, genre_id, rank, app_id FROM chart_ranks WHERE date = ? AND country = ?')
    .all(date, country) as RankRow[];
  if (!rows.length) return [];

  const curves = Object.fromEntries(CHART_TYPES.map((c) => [c, resolveCurve(db, country, c)])) as Record<
    ChartType,
    ResolvedCurve
  >;

  const perChart = {} as Record<ChartType, ReturnType<typeof equivalentRanksForChart>>;
  const saveMap = db.prepare(
    `INSERT OR REPLACE INTO rank_maps (date, country, chart, genre_id, alpha, beta, n_points, method)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const chart of CHART_TYPES) {
    perChart[chart] = equivalentRanksForChart(
      rows.filter((r) => r.chart === chart),
      chart === 'grossing' ? undefined : perChart.grossing.maps,
    );
    for (const [g, m] of perChart[chart].maps) saveMap.run(date, country, chart, g, m.alpha, m.beta, m.n, m.method);
  }

  const appIds = [...new Set(rows.map((r) => r.app_id))];
  const appInfo = new Map<number, { genre_id: number | null; price_usd: number | null; price_local: number | null }>();
  const infoStmt = db.prepare(`
    SELECT a.genre_id,
      (SELECT s.price FROM app_snapshots s WHERE s.app_id = a.id AND s.currency = 'USD' ORDER BY s.date DESC LIMIT 1) AS price_usd,
      (SELECT s.price FROM app_snapshots s WHERE s.app_id = a.id AND s.country = ? ORDER BY s.date DESC LIMIT 1) AS price_local
    FROM apps a WHERE a.id = ?`);
  for (const id of appIds) {
    const r = infoStmt.get(country, id) as { genre_id: number | null; price_usd: number | null; price_local: number | null } | undefined;
    appInfo.set(id, r ?? { genre_id: null, price_usd: null, price_local: null });
  }

  const results: AppEstimate[] = [];
  for (const appId of appIds) {
    const info = appInfo.get(appId)!;
    const g = perChart.grossing.eq.get(appId);
    const paidRank = perChart.paid.eq.get(appId);
    const freeRank = perChart.free.eq.get(appId);
    const isPaid = (info.price_local ?? info.price_usd ?? 0) > 0 || (!!paidRank && !freeRank);

    // Downloads: the chart that matches the app's price model.
    let downloads: number | null = null;
    let downloadsEqRank: number | null = null;
    let downloadsChart: ChartType | null = null;
    const dl = isPaid ? paidRank : freeRank;
    if (dl) {
      downloadsChart = isPaid ? 'paid' : 'free';
      downloadsEqRank = dl.rank;
      downloads = powerLaw(curves[downloadsChart].A, curves[downloadsChart].b, dl.rank);
    }

    let revenue: number | null = null;
    let method: RevenueMethod | null = null;
    let curveForBand: ResolvedCurve = curves.grossing;
    if (g) {
      revenue = powerLaw(curves.grossing.A, curves.grossing.b, g.rank);
      method = g.source === 'overall' ? 'grossing_overall' : 'grossing_category';
    } else if (isPaid && downloads !== null && info.price_usd) {
      revenue = downloads * info.price_usd;
      method = 'paid_downloads';
      curveForBand = curves.paid;
    } else if (!isPaid && downloads !== null) {
      const rpd = info.genre_id !== null ? RPD_PRIOR_BY_GENRE[info.genre_id] ?? DEFAULT_RPD : DEFAULT_RPD;
      revenue = downloads * rpd;
      method = 'downloads_rpd';
      curveForBand = curves.free;
    }

    const confidence = method ? METHOD_CONFIDENCE[method] : null;
    const f = confidence ? band(confidence, curveForBand) : 1;
    results.push({
      appId,
      revenue,
      revenueLow: revenue !== null ? revenue / f : null,
      revenueHigh: revenue !== null ? revenue * f : null,
      method,
      confidence,
      grossingEqRank: g?.rank ?? null,
      downloads,
      downloadsEqRank,
      downloadsChart,
      calibrated: method ? curveForBand.calibrated : false,
    });
  }

  const save = db.prepare(`
    INSERT OR REPLACE INTO estimates
      (date, country, app_id, revenue, revenue_low, revenue_high, revenue_method, confidence,
       grossing_eq_rank, downloads, downloads_eq_rank, downloads_chart, calibrated, model_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    db.prepare('DELETE FROM estimates WHERE date = ? AND country = ?').run(date, country);
    for (const e of results) {
      save.run(
        date, country, e.appId, e.revenue, e.revenueLow, e.revenueHigh, e.method, e.confidence,
        e.grossingEqRank, e.downloads, e.downloadsEqRank, e.downloadsChart, e.calibrated ? 1 : 0, MODEL_VERSION,
      );
    }
  })();
  return results;
}

/** Recompute every (date, country) that has chart data. Used after calibration. */
export function estimateAll(db: DB, opts: { since?: string } = {}): { days: number; rows: number } {
  const pairs = db
    .prepare(
      `SELECT DISTINCT date, country FROM chart_ranks ${opts.since ? 'WHERE date >= ?' : ''} ORDER BY date`,
    )
    .all(...(opts.since ? [opts.since] : [])) as { date: string; country: string }[];
  let rows = 0;
  for (const p of pairs) rows += estimateDay(db, p.date, p.country).length;
  return { days: pairs.length, rows };
}
