import type { DB } from '../db';
import { APPLE_COMMISSION, configuredCountries, US_PRIOR } from '../config';
import { priorCurve } from './params';
import { dateRange, mean } from './math';

/**
 * Calibration fits the top-grossing curve to real revenue figures.
 *
 * For a calibration point (app, country|'ww', period, revenue), the model
 * predicts  Σ_country Σ_day  s · A_prior(country) · eqRank(day)^(-b).
 * We search b on a grid and solve the scale s in closed form (least squares in
 * ln space), then store s and b as the 'global' grossing parameters. Countries
 * with >= 3 of their own points get an extra country-level scale.
 */

export interface CalibrationPoint {
  id: number;
  app_id: number;
  country: string;
  period_start: string;
  period_end: string;
  revenue_usd: number;
  revenue_type: 'gross' | 'proceeds';
  source: string;
  note: string | null;
}

export interface PointEvaluation {
  point: CalibrationPoint;
  usable: boolean;
  reason?: string;
  observedGross: number;
  coverage: number; // share of period days with a grossing rank (in the best-covered country)
  /** per country: list of daily eq ranks within the period */
  ranks: Map<string, number[]>;
  periodDays: number;
}

export interface FitResult {
  scale: number;
  b: number;
  nPoints: number;
  logRmse: number;
  mape: number;
  bFixed: boolean;
  countryScales: Record<string, { scale: number; n: number; logRmse: number }>;
  evaluations: PointEvaluation[];
}

const MIN_COVERAGE = 0.5;

export function grossFromPoint(p: Pick<CalibrationPoint, 'revenue_usd' | 'revenue_type'>): number {
  return p.revenue_type === 'gross' ? p.revenue_usd : p.revenue_usd / (1 - APPLE_COMMISSION);
}

export function evaluatePoint(db: DB, p: CalibrationPoint): PointEvaluation {
  const days = dateRange(p.period_start, p.period_end);
  const countries = p.country === 'ww' ? configuredCountries() : [p.country];
  const stmt = db.prepare(
    `SELECT date, grossing_eq_rank FROM estimates
     WHERE app_id = ? AND country = ? AND date BETWEEN ? AND ? AND grossing_eq_rank IS NOT NULL`,
  );
  const ranks = new Map<string, number[]>();
  let bestCoverage = 0;
  for (const c of countries) {
    const rows = stmt.all(p.app_id, c, p.period_start, p.period_end) as { grossing_eq_rank: number }[];
    if (rows.length) {
      ranks.set(c, rows.map((r) => r.grossing_eq_rank));
      bestCoverage = Math.max(bestCoverage, rows.length / days.length);
    }
  }
  const ev: PointEvaluation = {
    point: p,
    usable: true,
    observedGross: grossFromPoint(p),
    coverage: bestCoverage,
    ranks,
    periodDays: days.length,
  };
  if (!(ev.observedGross > 0)) return { ...ev, usable: false, reason: 'revenue must be > 0' };
  if (!ranks.size) return { ...ev, usable: false, reason: 'app has no top-grossing rank in this period' };
  if (bestCoverage < MIN_COVERAGE)
    return { ...ev, usable: false, reason: `only ${(bestCoverage * 100).toFixed(0)}% of days ranked (needs ${MIN_COVERAGE * 100}%)` };
  return ev;
}

/** Predicted period revenue for scale = 1 and exponent b (missing days filled with that country's mean). */
export function predictedUnscaled(ev: PointEvaluation, b: number): number {
  let total = 0;
  for (const [country, list] of ev.ranks) {
    const A = priorCurve(country, 'grossing').A;
    const sum = list.reduce((s, r) => s + A * Math.pow(r, -b), 0);
    total += sum * (ev.periodDays / list.length);
  }
  return total;
}

export function fit(evals: PointEvaluation[]): Omit<FitResult, 'evaluations' | 'countryScales'> | null {
  const usable = evals.filter((e) => e.usable);
  if (!usable.length) return null;
  const bFixed = usable.length < 3;
  const grid: number[] = [];
  if (bFixed) grid.push(US_PRIOR.grossing.b);
  else for (let b = 0.4; b <= 1.6 + 1e-9; b += 0.005) grid.push(Number(b.toFixed(3)));

  let best: { b: number; lnS: number; sse: number } | null = null;
  for (const b of grid) {
    const diffs = usable.map((e) => Math.log(e.observedGross) - Math.log(predictedUnscaled(e, b)));
    const lnS = mean(diffs);
    const sse = diffs.reduce((s, d) => s + (d - lnS) ** 2, 0);
    if (!best || sse < best.sse) best = { b, lnS, sse };
  }
  const scale = Math.exp(best!.lnS);
  const resid = usable.map((e) => Math.log(e.observedGross) - Math.log(scale * predictedUnscaled(e, best!.b)));
  const ape = usable.map((e) => Math.abs(scale * predictedUnscaled(e, best!.b) - e.observedGross) / e.observedGross);
  return {
    scale,
    b: best!.b,
    nPoints: usable.length,
    logRmse: Math.sqrt(resid.reduce((s, r) => s + r * r, 0) / usable.length),
    mape: mean(ape),
    bFixed,
  };
}

export function loadPoints(db: DB): CalibrationPoint[] {
  return db.prepare('SELECT * FROM calibration_points ORDER BY id').all() as CalibrationPoint[];
}

/** Fit, persist to model_params and return the result. Does not recompute estimates. */
export function runCalibration(db: DB): FitResult | null {
  // Evaluate against eq ranks — these do not depend on the curve, so the order is safe.
  const evaluations = loadPoints(db).map((p) => evaluatePoint(db, p));
  const global = fit(evaluations);
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`DELETE FROM model_params WHERE chart = 'grossing'`).run();
    if (!global) return;
    db.prepare(
      `INSERT INTO model_params (scope, chart, scale, b, n_points, log_rmse, mape, fitted_at)
       VALUES ('global', 'grossing', ?, ?, ?, ?, ?, ?)`,
    ).run(global.scale, global.b, global.nPoints, global.logRmse, global.mape, now);
  })();
  if (!global) return null;

  // Country-level scale for countries with >= 3 points of their own.
  const countryScales: FitResult['countryScales'] = {};
  const byCountry = new Map<string, PointEvaluation[]>();
  for (const e of evaluations.filter((x) => x.usable && x.point.country !== 'ww')) {
    const list = byCountry.get(e.point.country) ?? [];
    list.push(e);
    byCountry.set(e.point.country, list);
  }
  for (const [country, list] of byCountry) {
    if (list.length < 3) continue;
    const resid = list.map(
      (e) => Math.log(e.observedGross) - Math.log(global.scale * predictedUnscaled(e, global.b)),
    );
    const lnS = mean(resid);
    const rmse = Math.sqrt(resid.reduce((s, r) => s + (r - lnS) ** 2, 0) / list.length);
    countryScales[country] = { scale: Math.exp(lnS), n: list.length, logRmse: rmse };
    db.prepare(
      `INSERT INTO model_params (scope, chart, scale, b, n_points, log_rmse, mape, fitted_at)
       VALUES (?, 'grossing', ?, ?, ?, ?, NULL, ?)`,
    ).run(country, Math.exp(lnS), global.b, list.length, rmse, now);
  }
  return { ...global, countryScales, evaluations };
}

export interface NewPoint {
  app_id: number;
  country: string;
  period_start: string;
  period_end: string;
  revenue_usd: number;
  revenue_type: 'gross' | 'proceeds';
  source: string;
  note?: string | null;
}

export function validatePoint(p: NewPoint): string | null {
  if (!Number.isInteger(p.app_id) || p.app_id <= 0) return 'app_id must be a numeric App Store id';
  if (!/^([a-z]{2}|ww)$/.test(p.country)) return "country must be a 2-letter code or 'ww'";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.period_start) || !/^\d{4}-\d{2}-\d{2}$/.test(p.period_end))
    return 'dates must be YYYY-MM-DD';
  if (p.period_end < p.period_start) return 'period_end must be on or after period_start';
  if (!(p.revenue_usd > 0)) return 'revenue must be a positive number';
  if (p.revenue_type !== 'gross' && p.revenue_type !== 'proceeds') return "revenue_type must be 'gross' or 'proceeds'";
  if (!p.source?.trim()) return 'source is required';
  return null;
}

export function addPoint(db: DB, p: NewPoint): number {
  const err = validatePoint(p);
  if (err) throw new Error(err);
  const r = db
    .prepare(
      `INSERT INTO calibration_points (app_id, country, period_start, period_end, revenue_usd, revenue_type, source, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(p.app_id, p.country, p.period_start, p.period_end, p.revenue_usd, p.revenue_type, p.source.trim(), p.note ?? null, new Date().toISOString());
  return Number(r.lastInsertRowid);
}
