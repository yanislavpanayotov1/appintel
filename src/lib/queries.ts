import 'server-only';
import { getDb } from './db';
import { combine, type AggRow } from './aggregate';
import { addDays, dateRange } from './model/math';
import { GENRES, OVERALL, RATINGS_PER_DOWNLOAD, type Confidence, type RevenueMethod } from './config';
import { loadPoints, evaluatePoint, grossFromPoint, predictedUnscaled } from './model/calibrate';
import { resolveCurve } from './model/params';


export interface Meta {
  latestDate: string | null;
  firstDate: string | null;
  daysOfData: number;
  countries: string[];
  appsTracked: number;
  lastRun: { date: string; status: string; finished_at: string | null; feeds_failed: number } | null;
  calibrated: boolean;
  calibrationPoints: number;
}

export function getMeta(): Meta {
  const db = getDb();
  const d = db.prepare('SELECT MIN(date) first, MAX(date) latest, COUNT(DISTINCT date) days FROM estimates').get() as {
    first: string | null;
    latest: string | null;
    days: number;
  };
  const countries = (
    db.prepare('SELECT DISTINCT country FROM estimates ORDER BY country').all() as { country: string }[]
  ).map((r) => r.country);
  const apps = (db.prepare('SELECT COUNT(*) n FROM apps').get() as { n: number }).n;
  const lastRun = db
    .prepare('SELECT date, status, finished_at, feeds_failed FROM scrape_runs ORDER BY id DESC LIMIT 1')
    .get() as Meta['lastRun'] | undefined;
  const params = db.prepare(`SELECT COUNT(*) n FROM model_params WHERE chart = 'grossing'`).get() as { n: number };
  const pts = db.prepare('SELECT COUNT(*) n FROM calibration_points').get() as { n: number };
  return {
    latestDate: d.latest,
    firstDate: d.first,
    daysOfData: d.days,
    countries,
    appsTracked: apps,
    lastRun: lastRun ?? null,
    calibrated: params.n > 0,
    calibrationPoints: pts.n,
  };
}

/* -------------------------------------------------------------------------- */
/* Leaderboard                                                                */
/* -------------------------------------------------------------------------- */

export type SortKey = 'revenue' | 'growth' | 'downloads' | 'rpd';
export interface LeaderboardFilter {
  country: string; // 'all' or ISO code
  genre: number | null;
  confidence: Confidence | 'all';
  model: 'all' | 'free' | 'paid';
  window: 7 | 30 | 90;
  sort: SortKey;
  q: string;
  page: number;
  pageSize: number;
}

export interface LeaderRow {
  appId: number;
  name: string;
  developer: string | null;
  genreId: number | null;
  genreName: string | null;
  iconUrl: string | null;
  price: number | null;
  dailyRevenue: number;
  dailyLow: number;
  dailyHigh: number;
  monthlyRevenue: number;
  monthlyLow: number;
  monthlyHigh: number;
  dailyDownloads: number | null;
  rpd: number | null;
  growth: number | null; // last 7d vs previous 7d, as ratio - 1
  daysObserved: number;
  windowDays: number;
  confidence: Confidence;
  method: RevenueMethod;
  calibrated: boolean;
  countries: number;
  topCountry: string;
}


function windowBounds(latest: string, window: number) {
  return { start: addDays(latest, -(window - 1)), recentStart: addDays(latest, -7), priorStart: addDays(latest, -14) };
}

/** Per (app, country) aggregates over the window; combined across countries in JS. */
function aggregate(latest: string, window: number, country: string, appId?: number): AggRow[] {
  const db = getDb();
  const { start, recentStart, priorStart } = windowBounds(latest, Math.max(window, 14));
  const winStart = addDays(latest, -(window - 1));
  return db
    .prepare(
      `SELECT app_id, country,
        AVG(CASE WHEN date >= @winStart THEN revenue END) avg_rev,
        AVG(CASE WHEN date >= @winStart THEN revenue_low END) avg_lo,
        AVG(CASE WHEN date >= @winStart THEN revenue_high END) avg_hi,
        AVG(CASE WHEN date >= @winStart THEN downloads END) avg_dl,
        COUNT(CASE WHEN date >= @winStart THEN 1 END) days,
        AVG(CASE WHEN date > @recentStart THEN revenue END) rec,
        COUNT(CASE WHEN date > @recentStart THEN 1 END) rec_n,
        AVG(CASE WHEN date > @priorStart AND date <= @recentStart THEN revenue END) pri,
        COUNT(CASE WHEN date > @priorStart AND date <= @recentStart THEN 1 END) pri_n,
        (SELECT CASE e2.confidence WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END FROM estimates e2
           WHERE e2.app_id = e.app_id AND e2.country = e.country AND e2.revenue IS NOT NULL ORDER BY e2.date DESC LIMIT 1) conf,
        (SELECT e2.revenue_method FROM estimates e2 WHERE e2.app_id = e.app_id AND e2.country = e.country
           AND e2.revenue IS NOT NULL ORDER BY e2.date DESC LIMIT 1) method,
        MAX(calibrated) calibrated
      FROM estimates e
      WHERE date BETWEEN @start AND @latest AND revenue IS NOT NULL
        ${country === 'all' ? '' : 'AND country = @country'}
        ${appId === undefined ? '' : 'AND app_id = @appId'}
      GROUP BY app_id, country`,
    )
    .all({ start: start < winStart ? start : winStart, winStart, latest, recentStart, priorStart, country, appId: appId ?? null }) as AggRow[];
}

export function getLeaderboard(f: LeaderboardFilter): { rows: LeaderRow[]; total: number; totals: { monthly: number; apps: number; top: LeaderRow | null } } {
  const meta = getMeta();
  if (!meta.latestDate) return { rows: [], total: 0, totals: { monthly: 0, apps: 0, top: null } };
  const db = getDb();
  const combined = combine(aggregate(meta.latestDate, f.window, f.country), f.window);
  const apps = db
    .prepare('SELECT id, name, developer, genre_id, genre_name, icon_url, price FROM apps')
    .all() as { id: number; name: string; developer: string | null; genre_id: number | null; genre_name: string | null; icon_url: string | null; price: number | null }[];
  const appMap = new Map(apps.map((a) => [a.id, a]));
  const q = f.q.trim().toLowerCase();
  let rows: LeaderRow[] = [];
  for (const c of combined.values()) {
    const a = appMap.get(c.appId);
    if (!a) continue;
    if (f.genre !== null && a.genre_id !== f.genre) continue;
    if (f.confidence !== 'all' && c.confidence !== f.confidence) continue;
    if (f.model === 'paid' && !(a.price && a.price > 0)) continue;
    if (f.model === 'free' && a.price && a.price > 0) continue;
    if (q && !a.name.toLowerCase().includes(q) && !(a.developer ?? '').toLowerCase().includes(q)) continue;
    rows.push({
      ...c,
      name: a.name,
      developer: a.developer,
      genreId: a.genre_id,
      genreName: (a.genre_id !== null && GENRES[a.genre_id]) || a.genre_name,
      iconUrl: a.icon_url,
      price: a.price,
    });
  }
  const key: Record<SortKey, (r: LeaderRow) => number> = {
    revenue: (r) => r.dailyRevenue,
    growth: (r) => r.growth ?? -Infinity,
    downloads: (r) => r.dailyDownloads ?? -Infinity,
    rpd: (r) => r.rpd ?? -Infinity,
  };
  rows.sort((a, b) => key[f.sort](b) - key[f.sort](a) || b.dailyRevenue - a.dailyRevenue);
  const top = rows.reduce<LeaderRow | null>((best, r) => (!best || r.dailyRevenue > best.dailyRevenue ? r : best), null);
  const totals = { monthly: rows.reduce((s, r) => s + r.monthlyRevenue, 0), apps: rows.length, top };
  const total = rows.length;
  rows = rows.slice((f.page - 1) * f.pageSize, f.page * f.pageSize);
  return { rows, total, totals };
}

/** Daily revenue series (summed over countries) for a set of apps. */
export function getSparklines(appIds: number[], country: string, days: number): Map<number, (number | null)[]> {
  const meta = getMeta();
  const out = new Map<number, (number | null)[]>();
  if (!meta.latestDate || !appIds.length) return out;
  const dates = dateRange(addDays(meta.latestDate, -(days - 1)), meta.latestDate);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT app_id, date, SUM(revenue) rev FROM estimates
       WHERE app_id IN (${appIds.map(() => '?').join(',')}) AND date >= ? AND revenue IS NOT NULL
       ${country === 'all' ? '' : 'AND country = ?'}
       GROUP BY app_id, date`,
    )
    .all(...appIds, dates[0], ...(country === 'all' ? [] : [country])) as { app_id: number; date: string; rev: number }[];
  const idx = new Map(dates.map((d, i) => [d, i]));
  for (const id of appIds) out.set(id, dates.map(() => null));
  for (const r of rows) out.get(r.app_id)![idx.get(r.date)!] = r.rev;
  return out;
}

/* -------------------------------------------------------------------------- */
/* App detail                                                                 */
/* -------------------------------------------------------------------------- */

export interface AppDetail {
  app: {
    id: number;
    name: string;
    developer: string | null;
    genre_id: number | null;
    genre_name: string | null;
    icon_url: string | null;
    url: string | null;
    price: number | null;
    currency: string | null;
    release_date: string | null;
    first_seen: string;
    bundle_id: string | null;
  };
  summary: LeaderRow | null;
  byCountry: { country: string; daily: number; low: number; high: number; downloads: number | null; days: number; method: RevenueMethod; confidence: Confidence; grossingEqRank: number | null; calibrated: boolean }[];
  series: { date: string; revenue: number | null; low: number | null; high: number | null; downloads: number | null }[];
  ranks: { date: string; country: string; chart: string; genreId: number; rank: number }[];
  ratings: { date: string; country: string; ratingCount: number | null; ratingAvg: number | null }[];
  ratingVelocity: { perDay: number | null; impliedDownloads: number | null; days: number } | null;
  calibration: ReturnType<typeof getCalibration>['points'];
  latestMaps: { country: string; chart: string; genreId: number; method: string; n: number }[];
}

export function getApp(id: number, window: 7 | 30 | 90 = 30): AppDetail | null {
  const db = getDb();
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(id) as AppDetail['app'] | undefined;
  if (!app) return null;
  const meta = getMeta();
  const latest = meta.latestDate ?? new Date().toISOString().slice(0, 10);
  const all = combine(aggregate(latest, window, 'all', id), window).get(id);
  const summary: LeaderRow | null = all
    ? { ...all, name: app.name, developer: app.developer, genreId: app.genre_id, genreName: (app.genre_id !== null && GENRES[app.genre_id]) || app.genre_name, iconUrl: app.icon_url, price: app.price }
    : null;

  const start = addDays(latest, -(window - 1));
  const byCountryRows = db
    .prepare(
      `SELECT country, AVG(revenue) daily, AVG(revenue_low) low, AVG(revenue_high) high, AVG(downloads) downloads,
              COUNT(*) days, MAX(calibrated) calibrated,
              (SELECT revenue_method FROM estimates e2 WHERE e2.app_id = e.app_id AND e2.country = e.country AND e2.revenue IS NOT NULL ORDER BY date DESC LIMIT 1) method,
              (SELECT confidence FROM estimates e2 WHERE e2.app_id = e.app_id AND e2.country = e.country AND e2.revenue IS NOT NULL ORDER BY date DESC LIMIT 1) confidence,
              (SELECT grossing_eq_rank FROM estimates e2 WHERE e2.app_id = e.app_id AND e2.country = e.country ORDER BY date DESC LIMIT 1) grossingEqRank
       FROM estimates e WHERE app_id = ? AND date BETWEEN ? AND ? AND revenue IS NOT NULL
       GROUP BY country ORDER BY daily DESC`,
    )
    .all(id, start, latest) as (Omit<AppDetail['byCountry'][number], 'calibrated'> & { calibrated: number })[];
  const byCountry = byCountryRows.map((r) => ({ ...r, calibrated: !!r.calibrated }));

  const seriesRows = db
    .prepare(
      `SELECT date, SUM(revenue) revenue, SUM(revenue_low) low, SUM(revenue_high) high, SUM(downloads) downloads
       FROM estimates WHERE app_id = ? AND date >= ? GROUP BY date`,
    )
    .all(id, addDays(latest, -89)) as AppDetail['series'];
  const seriesMap = new Map(seriesRows.map((r) => [r.date, r]));
  const firstSeriesDate = seriesRows.length ? seriesRows[0].date : latest;
  const series = dateRange(firstSeriesDate < addDays(latest, -89) ? addDays(latest, -89) : firstSeriesDate, latest).map(
    (date) => seriesMap.get(date) ?? { date, revenue: null, low: null, high: null, downloads: null },
  );

  const ranks = db
    .prepare(
      `SELECT date, country, chart, genre_id genreId, rank FROM chart_ranks WHERE app_id = ? AND date >= ? ORDER BY date`,
    )
    .all(id, addDays(latest, -89)) as AppDetail['ranks'];

  const ratings = db
    .prepare(
      `SELECT date, country, rating_count ratingCount, rating_avg ratingAvg FROM app_snapshots WHERE app_id = ? ORDER BY date`,
    )
    .all(id) as AppDetail['ratings'];

  // Rating velocity, US preferred: (last - first) / days between them.
  let ratingVelocity: AppDetail['ratingVelocity'] = null;
  const pick = ratings.some((r) => r.country === 'us') ? 'us' : ratings[0]?.country;
  const rs = ratings.filter((r) => r.country === pick && r.ratingCount !== null);
  if (rs.length >= 2) {
    const a = rs[0];
    const b = rs[rs.length - 1];
    const days = (Date.parse(b.date) - Date.parse(a.date)) / 86_400_000;
    if (days > 0) {
      const perDay = ((b.ratingCount ?? 0) - (a.ratingCount ?? 0)) / days;
      ratingVelocity = { perDay, impliedDownloads: perDay > 0 ? perDay / RATINGS_PER_DOWNLOAD : null, days };
    }
  } else if (rs.length === 1) {
    ratingVelocity = { perDay: null, impliedDownloads: null, days: 0 };
  }

  const latestMaps = db
    .prepare(
      `SELECT DISTINCT m.country, m.chart, m.genre_id genreId, m.method, m.n_points n
       FROM chart_ranks r JOIN rank_maps m ON m.date = r.date AND m.country = r.country AND m.chart = r.chart AND m.genre_id = r.genre_id
       WHERE r.app_id = ? AND r.date = ? AND r.genre_id != ${OVERALL}`,
    )
    .all(id, latest) as AppDetail['latestMaps'];

  const calibration = getCalibration().points.filter((p) => p.appId === id);
  return { app, summary, byCountry, series, ranks, ratings, ratingVelocity, calibration, latestMaps };
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

export interface CategoryRow {
  genreId: number;
  name: string;
  monthly: number;
  apps: number;
  topApp: { id: number; name: string; monthly: number; iconUrl: string | null } | null;
  share: number;
  growth: number | null;
}

export function getCategories(country: string, window: 7 | 30 | 90): { rows: CategoryRow[]; total: number } {
  const meta = getMeta();
  if (!meta.latestDate) return { rows: [], total: 0 };
  const combined = combine(aggregate(meta.latestDate, window, country), window);
  const db = getDb();
  const apps = db.prepare('SELECT id, name, genre_id, icon_url FROM apps').all() as {
    id: number;
    name: string;
    genre_id: number | null;
    icon_url: string | null;
  }[];
  const appMap = new Map(apps.map((a) => [a.id, a]));
  const byGenre = new Map<number, { monthly: number; apps: number; top: CategoryRow['topApp']; rec: number; pri: number; hasGrowth: boolean }>();
  for (const c of combined.values()) {
    const a = appMap.get(c.appId);
    if (!a || a.genre_id === null || !GENRES[a.genre_id]) continue;
    const g = byGenre.get(a.genre_id) ?? { monthly: 0, apps: 0, top: null, rec: 0, pri: 0, hasGrowth: false };
    g.monthly += c.monthlyRevenue;
    g.apps += 1;
    if (!g.top || c.monthlyRevenue > g.top.monthly) g.top = { id: a.id, name: a.name, monthly: c.monthlyRevenue, iconUrl: a.icon_url };
    if (c.growth !== null) {
      g.hasGrowth = true;
      g.pri += c.dailyRevenue / (1 + c.growth);
      g.rec += c.dailyRevenue;
    }
    byGenre.set(a.genre_id, g);
  }
  const total = [...byGenre.values()].reduce((s, g) => s + g.monthly, 0);
  const rows = [...byGenre.entries()]
    .map(([genreId, g]) => ({
      genreId,
      name: GENRES[genreId],
      monthly: g.monthly,
      apps: g.apps,
      topApp: g.top,
      share: total ? g.monthly / total : 0,
      growth: g.hasGrowth && g.pri > 0 ? g.rec / g.pri - 1 : null,
    }))
    .sort((a, b) => b.monthly - a.monthly);
  return { rows, total };
}

/* -------------------------------------------------------------------------- */
/* Calibration                                                                */
/* -------------------------------------------------------------------------- */

export function getCalibration() {
  const db = getDb();
  const names = new Map(
    (db.prepare('SELECT id, name, icon_url FROM apps').all() as { id: number; name: string; icon_url: string | null }[]).map((a) => [a.id, a]),
  );
  const params = db.prepare(`SELECT * FROM model_params WHERE chart = 'grossing' ORDER BY scope != 'global', scope`).all() as {
    scope: string;
    scale: number;
    b: number;
    n_points: number;
    log_rmse: number | null;
    mape: number | null;
    fitted_at: string;
  }[];
  const global = params.find((p) => p.scope === 'global');
  const points = loadPoints(db).map((p) => {
    const ev = evaluatePoint(db, p);
    const predicted = ev.usable && global ? global.scale * predictedUnscaled(ev, global.b) : ev.usable ? predictedUnscaled(ev, resolveCurve(db, 'us', 'grossing').b) : null;
    return {
      id: p.id,
      appId: p.app_id,
      appName: names.get(p.app_id)?.name ?? null,
      iconUrl: names.get(p.app_id)?.icon_url ?? null,
      country: p.country,
      periodStart: p.period_start,
      periodEnd: p.period_end,
      revenue: p.revenue_usd,
      revenueType: p.revenue_type,
      observedGross: grossFromPoint(p),
      source: p.source,
      note: p.note,
      usable: ev.usable,
      reason: ev.reason ?? null,
      coverage: ev.coverage,
      predicted,
    };
  });
  return { points, params };
}

/** Daily grossing overall-equivalent rank for one app in one country (last 90 days). */
export function getRankSeries(id: number, country: string): { date: string; eq: number | null; method: string | null }[] {
  const meta = getMeta();
  if (!meta.latestDate) return [];
  const db = getDb();
  const start = addDays(meta.latestDate, -89);
  const rows = db
    .prepare(
      `SELECT date, grossing_eq_rank eq, revenue_method method FROM estimates WHERE app_id = ? AND country = ? AND date >= ?`,
    )
    .all(id, country, start) as { date: string; eq: number | null; method: string | null }[];
  if (!rows.length) return [];
  const map = new Map(rows.map((r) => [r.date, r]));
  return dateRange(rows[0].date, meta.latestDate).map((d) => map.get(d) ?? { date: d, eq: null, method: null });
}
