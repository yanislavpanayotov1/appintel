import { UNMAPPED_CATEGORY_TOP_RANK, MAX_EQUIVALENT_RANK } from '../config';
import { median, ols, clamp } from './math';

/**
 * Category charts only show a category's top 100. To put a category rank on the
 * same scale as the overall chart, we use apps that appear in BOTH charts on
 * the same day and fit  ln(overallRank) = alpha + beta * ln(categoryRank).
 */
export interface RankMap {
  alpha: number;
  beta: number;
  n: number;
  method: 'fitted' | 'anchored' | 'borrowed' | 'unmapped';
}

export interface Pair {
  categoryRank: number;
  overallRank: number;
}

const BETA_MIN = 0.5;
const BETA_MAX = 2.5;
export const DEFAULT_BETA = 1.2;

/** Fit a map from overlapping pairs; falls back to anchored / unmapped forms. */
export function fitRankMap(pairs: Pair[], pooledBeta: number = DEFAULT_BETA): RankMap {
  const beta0 = clamp(Number.isFinite(pooledBeta) ? pooledBeta : DEFAULT_BETA, BETA_MIN, BETA_MAX);
  if (pairs.length >= 3) {
    const fit = ols(
      pairs.map((p) => Math.log(p.categoryRank)),
      pairs.map((p) => Math.log(p.overallRank)),
    );
    if (fit && fit.slope >= BETA_MIN && fit.slope <= BETA_MAX) {
      return { alpha: fit.intercept, beta: fit.slope, n: pairs.length, method: 'fitted' };
    }
  }
  if (pairs.length >= 1) {
    // Fix the slope, solve the intercept from the observed overlap.
    const alpha =
      pairs.reduce((s, p) => s + Math.log(p.overallRank) - beta0 * Math.log(p.categoryRank), 0) /
      pairs.length;
    return { alpha, beta: beta0, n: pairs.length, method: 'anchored' };
  }
  // No app of this category made the overall chart: its #1 sits below the overall cut-off.
  return { alpha: Math.log(UNMAPPED_CATEGORY_TOP_RANK), beta: beta0, n: 0, method: 'unmapped' };
}

/** Median slope of the fitted maps of one day, used as the slope for sparse categories. */
export function pooledBeta(maps: RankMap[]): number {
  const betas = maps.filter((m) => m.method === 'fitted').map((m) => m.beta);
  return betas.length ? median(betas) : DEFAULT_BETA;
}

/**
 * Overall-equivalent rank for a category rank.
 * @param overallSize number of entries in that day's overall chart; an app that
 *        is not in the overall chart must rank below it.
 * @param inOverall true if the app also appears in the overall chart (then the
 *        caller should use the real overall rank instead).
 */
export function equivalentRank(map: RankMap, categoryRank: number, overallSize: number): number {
  let eq = Math.exp(map.alpha + map.beta * Math.log(categoryRank));
  // An app cannot rank higher overall than within its own category,
  // and an app absent from the overall chart ranks below its last entry.
  // A borrowed map means the category is absent from this overall chart altogether
  // (not merely ranked below it), so the overall cut-off does not bound it.
  eq = map.method === 'borrowed' ? Math.max(eq, categoryRank) : Math.max(eq, categoryRank, overallSize + 1);
  return Math.min(eq, MAX_EQUIVALENT_RANK);
}
