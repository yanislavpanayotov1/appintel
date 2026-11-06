import type { DB } from '../db';
import {
  US_PRIOR,
  COUNTRY_SCALE_PRIOR,
  DEFAULT_COUNTRY_SCALE,
  type ChartType,
  type Curve,
} from '../config';

export interface ResolvedCurve extends Curve {
  calibrated: boolean;
  /** residual std in ln space from calibration, if fitted */
  logRmse: number | null;
  nPoints: number;
}

interface ParamRow {
  scope: string;
  chart: string;
  scale: number;
  b: number;
  n_points: number;
  log_rmse: number | null;
}

/** A_prior for a country = US prior A × country market-size prior. */
export function priorCurve(country: string, chart: ChartType): Curve {
  const base = US_PRIOR[chart];
  const cs = COUNTRY_SCALE_PRIOR[country] ?? DEFAULT_COUNTRY_SCALE;
  return { A: base.A * cs, b: base.b };
}

/**
 * Curve actually used: prior, adjusted by the global calibration fit and, when
 * the country has its own calibration points, by a country-level scale.
 */
export function resolveCurve(db: DB, country: string, chart: ChartType): ResolvedCurve {
  const prior = priorCurve(country, chart);
  const rows = db
    .prepare('SELECT * FROM model_params WHERE chart = ? AND scope IN (?, ?)')
    .all(chart, 'global', country) as ParamRow[];
  const global = rows.find((r) => r.scope === 'global');
  const local = rows.find((r) => r.scope === country);
  if (!global && !local) {
    return { ...prior, calibrated: false, logRmse: null, nPoints: 0 };
  }
  const scale = (global?.scale ?? 1) * (local?.scale ?? 1);
  const b = local?.b ?? global?.b ?? prior.b;
  return {
    A: prior.A * scale,
    b,
    calibrated: true,
    logRmse: local?.log_rmse ?? global?.log_rmse ?? null,
    nPoints: (global?.n_points ?? 0) + (local?.n_points ?? 0),
  };
}
