/**
 * Central configuration. Everything the scraper collects and every model
 * assumption lives here so the scraper, the estimator and the UI agree.
 */

export type ChartType = 'grossing' | 'free' | 'paid';
export const CHART_TYPES: ChartType[] = ['grossing', 'free', 'paid'];

/** Apple legacy iTunes RSS feed names (iPhone charts). Max 100 entries per feed. */
export const FEED_NAME: Record<ChartType, string> = {
  grossing: 'topgrossingapplications',
  free: 'topfreeapplications',
  paid: 'toppaidapplications',
};

/** genre_id 0 = overall chart (all categories). */
export const OVERALL = 0;

/**
 * iOS app genres. IDs verified against Apple's chart feeds on 2026-11-06
 * (6021 Magazines, 6022 Catalogs and 6025 Stickers return empty or mixed charts and are excluded).
 */
export const GENRES: Record<number, string> = {
  6000: 'Business',
  6001: 'Weather',
  6002: 'Utilities',
  6003: 'Travel',
  6004: 'Sports',
  6005: 'Social Networking',
  6006: 'Reference',
  6007: 'Productivity',
  6008: 'Photo & Video',
  6009: 'News',
  6010: 'Navigation',
  6011: 'Music',
  6012: 'Lifestyle',
  6013: 'Health & Fitness',
  6014: 'Games',
  6015: 'Finance',
  6016: 'Entertainment',
  6017: 'Education',
  6018: 'Books',
  6020: 'Medical',
  6023: 'Food & Drink',
  6024: 'Shopping',
  6026: 'Developer Tools',
  6027: 'Graphics & Design',
};
export const GENRE_IDS = Object.keys(GENRES).map(Number);

export const COUNTRY_NAMES: Record<string, string> = {
  us: 'United States',
  gb: 'United Kingdom',
  de: 'Germany',
  fr: 'France',
  jp: 'Japan',
  ca: 'Canada',
  au: 'Australia',
  kr: 'South Korea',
  cn: 'China',
  it: 'Italy',
  es: 'Spain',
  br: 'Brazil',
  nl: 'Netherlands',
  se: 'Sweden',
  ch: 'Switzerland',
};

export function configuredCountries(): string[] {
  const raw = process.env.APPINTEL_COUNTRIES ?? 'us,gb,de,fr,jp,ca,au';
  return raw
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter((c) => /^[a-z]{2}$/.test(c));
}

/* -------------------------------------------------------------------------- */
/* Model assumptions                                                          */
/* -------------------------------------------------------------------------- */

/**
 * PRIORS: these are starting assumptions, NOT verified figures. They make the
 * model produce numbers on day one. They are replaced by fitted values once
 * calibration points (real revenue for known apps) are added and
 * `npm run calibrate:fit` is run. The UI labels every estimate as
 * "uncalibrated" while only priors are in use.
 */
export const MODEL_VERSION = 'v1';

/** Power law: value(rank) = A * rank^(-b), rank = overall-chart-equivalent rank. */
export interface Curve {
  A: number;
  b: number;
}

/** US iPhone priors. Revenue in USD/day (gross, customer spend). Downloads per day. */
export const US_PRIOR: Record<ChartType, Curve> = {
  grossing: { A: 1_500_000, b: 0.9 },
  free: { A: 120_000, b: 0.75 },
  paid: { A: 6_000, b: 0.8 },
};

/**
 * Relative market size vs US, applied to A for every chart. PRIOR — replace via
 * per-country calibration (a country with >= 3 calibration points gets its own scale).
 */
export const COUNTRY_SCALE_PRIOR: Record<string, number> = {
  us: 1,
  jp: 0.55,
  cn: 0.9,
  kr: 0.2,
  gb: 0.12,
  de: 0.12,
  fr: 0.08,
  ca: 0.08,
  au: 0.07,
  it: 0.05,
  es: 0.04,
  br: 0.04,
  nl: 0.03,
  se: 0.02,
  ch: 0.03,
};
export const DEFAULT_COUNTRY_SCALE = 0.02;

/**
 * Revenue per download (USD) for apps with no grossing rank but a free-chart
 * rank. Used only for "low" confidence estimates. PRIOR.
 */
export const DEFAULT_RPD = 0.05;
export const RPD_PRIOR_BY_GENRE: Record<number, number> = {
  6014: 0.2, // Games
  6013: 0.15, // Health & Fitness
  6007: 0.12, // Productivity
  6008: 0.1, // Photo & Video
  6017: 0.08, // Education
  6005: 0.04, // Social Networking
  6024: 0.0, // Shopping (revenue is off-store)
  6023: 0.0, // Food & Drink (revenue is mostly off-store)
  6003: 0.0, // Travel
  6015: 0.01, // Finance
};

/** Apple's commission. Standard 30%; Small Business Program / year-2 subscriptions are 15%. */
export const APPLE_COMMISSION = 0.3;

/**
 * When a category chart has no apps in the overall top 100 we cannot map its
 * ranks from data; we then assume category #1 sits at this overall rank.
 */
export const UNMAPPED_CATEGORY_TOP_RANK = 110;

/** Ranks are extrapolated (power-law) up to this overall-equivalent rank, no further. */
export const MAX_EQUIVALENT_RANK = 5000;

/** Uncertainty band multipliers (×/÷) when no calibration residuals are available. */
export const DEFAULT_BAND: Record<Confidence, number> = {
  high: 1.8,
  medium: 2.5,
  low: 4,
};

/** Assumed share of downloaders who leave a rating — used for the rating-velocity cross-check only. PRIOR. */
export const RATINGS_PER_DOWNLOAD = 0.015;

export type Confidence = 'high' | 'medium' | 'low';

export type RevenueMethod =
  | 'grossing_overall' // ranked in overall top-grossing chart
  | 'grossing_category' // ranked only in a category top-grossing chart (mapped to overall-equivalent rank)
  | 'paid_downloads' // paid app: downloads (paid chart) × price
  | 'downloads_rpd'; // free-chart downloads × category revenue-per-download

export const METHOD_LABEL: Record<RevenueMethod, string> = {
  grossing_overall: 'Overall top-grossing rank',
  grossing_category: 'Category top-grossing rank',
  paid_downloads: 'Paid downloads × price',
  downloads_rpd: 'Downloads × revenue per download',
};

export const METHOD_CONFIDENCE: Record<RevenueMethod, Confidence> = {
  grossing_overall: 'high',
  grossing_category: 'medium',
  paid_downloads: 'medium',
  downloads_rpd: 'low',
};
