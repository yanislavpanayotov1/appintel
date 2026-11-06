/**
 * Keyword scoring: pure functions, no I/O.
 *
 * All three scores are heuristics built from public signals. Apple does not
 * publish search volume (its Search Ads "popularity" needs an advertiser
 * account), so these rank keywords against each other rather than measure
 * searches.
 */

export function normaliseTerm(term: string): string {
  return term.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function tokens(term: string): string[] {
  return normaliseTerm(term)
    .split(/[\s\-–—:|,.&/+]+/)
    .filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* Popularity — "what is being searched"                                      */
/* -------------------------------------------------------------------------- */

export interface HintMatch {
  /** characters typed before the App Store suggested the exact term */
  prefixLength: number;
  /** 1-based position in that suggestion list */
  position: number;
  /**
   * false when Apple never suggests the term itself but does suggest longer
   * phrases that start with it ("budget" → "budget app"): scored × 0.9.
   */
  exact: boolean;
}

/**
 * Popularity 0–100 from App Store autocomplete. A term Apple suggests after
 * fewer typed characters, and higher in the list, is searched more often.
 * Not found at any prefix → 0 (long-tail or rarely searched).
 */
export function popularityScore(term: string, match: HintMatch | null): number {
  if (!match) return 0;
  const n = Math.max(1, [...normaliseTerm(term)].length);
  const L = Math.min(Math.max(1, match.prefixLength), n);
  const reach = (n - L + 1) / n; // 1 when suggested after one character
  const posFactor = 1 - 0.05 * (Math.min(Math.max(1, match.position), 10) - 1);
  const exactFactor = match.exact ? 1 : 0.9;
  // Even a term found only when typed in full is searched by someone: floor at 5.
  return Math.round(Math.max(5, 100 * Math.pow(reach, 1.5) * posFactor * exactFactor) * 10) / 10;
}

/** Prefixes to try, shortest first, ending with the full term. */
export function prefixesOf(term: string, maxLen = 24): string[] {
  const chars = [...normaliseTerm(term)];
  const out: string[] = [];
  for (let i = 1; i <= Math.min(chars.length, maxLen); i++) {
    const p = chars.slice(0, i).join('');
    if (p.endsWith(' ')) continue; // the same as the prefix without the space for autocomplete
    out.push(p);
  }
  const full = chars.join('');
  if (out[out.length - 1] !== full) out.push(full);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Difficulty — the competition                                               */
/* -------------------------------------------------------------------------- */

export interface ResultApp {
  appId: number;
  title: string;
  ratingCount: number;
  releaseDate: string | null; // ISO
  /** estimated monthly revenue in this country, or null if below the charts */
  monthlyRevenue: number | null;
}

export interface Competition {
  ratingStrength: number; // 0-100
  titleMatch: number; // 0-1
  chartingShare: number; // 0-1
  freshShare: number; // 0-1
  difficulty: number; // 0-100
  nicheRevenue: number; // USD / month, top 10
  top5MedianRevenue: number; // USD / month
}

export const TOP_N = 10;
const RATINGS_FOR_MAX = 1_000_000;

export function titleMatches(title: string, term: string): boolean {
  const t = tokens(title);
  return tokens(term).every((w) => t.some((x) => x === w || x.startsWith(w)));
}

export function competition(term: string, results: ResultApp[], today: string): Competition {
  const top = results.slice(0, TOP_N);
  if (!top.length) {
    return { ratingStrength: 0, titleMatch: 0, chartingShare: 0, freshShare: 0, difficulty: 0, nicheRevenue: 0, top5MedianRevenue: 0 };
  }
  const k = top.length;
  // Rating volume is the strongest public proxy for an app's install base.
  const ratingStrength =
    (top.reduce((s, a) => s + Math.min(1, Math.log10(a.ratingCount + 1) / Math.log10(RATINGS_FOR_MAX)), 0) / k) * 100;
  const titleMatch = top.filter((a) => titleMatches(a.title, term)).length / k;
  const chartingShare = top.filter((a) => (a.monthlyRevenue ?? 0) > 0).length / k;
  const cutoff = Date.parse(today + 'T00:00:00Z') - 365 * 86_400_000;
  const freshShare = top.filter((a) => a.releaseDate && Date.parse(a.releaseDate) >= cutoff).length / k;
  const raw = 0.55 * ratingStrength + 25 * titleMatch + 20 * chartingShare - 10 * freshShare;
  const difficulty = Math.round(Math.min(100, Math.max(0, raw)) * 10) / 10;
  const nicheRevenue = top.reduce((s, a) => s + (a.monthlyRevenue ?? 0), 0);
  const top5 = results.slice(0, 5).map((a) => a.monthlyRevenue ?? 0).sort((a, b) => a - b);
  const top5MedianRevenue = top5.length ? top5[Math.floor(top5.length / 2)] : 0;
  return { ratingStrength, titleMatch, chartingShare, freshShare, difficulty, nicheRevenue, top5MedianRevenue };
}

/* -------------------------------------------------------------------------- */
/* Opportunity — the best picks                                               */
/* -------------------------------------------------------------------------- */

/**
 * 0–100. Geometric mean of demand (popularity) and openness (100 − difficulty),
 * scaled 0.6–1.0 by how much money the niche makes (≥ $10M/month → 1.0).
 */
export function opportunityScore(popularity: number, difficulty: number, nicheRevenue: number): number {
  const monetisation = 0.6 + 0.4 * Math.min(1, Math.log10(1 + Math.max(0, nicheRevenue)) / 7);
  const v = Math.sqrt(Math.max(0, popularity) * Math.max(0, 100 - difficulty)) * monetisation;
  return Math.round(v * 10) / 10;
}

/* -------------------------------------------------------------------------- */
/* Brand detection                                                            */
/* -------------------------------------------------------------------------- */

const TITLE_PUNCTUATION = /\s[-–—•|]\s|[:：•™®]|[–—]/;

/** The name part of a store title: "PDF Expert: Editor & Reader" → "pdf expert". */
export function titleName(title: string): string {
  return normaliseTerm(title.split(/\s[-–—|•]\s|[:：|•]/)[0] ?? title);
}

/** Brand words are rare: a word in at most this many app names counts as a name, not a description. */
export const BRAND_WORD_MAX_APPS = 5;

/**
 * True when the keyword is someone looking for one specific app rather than a
 * kind of app. Autocomplete suggests many of these ("huckleberry: baby tracker").
 * - it contains store-title punctuation (people rarely type ":" or " - "), or
 * - it starts with the name of a top-3 result, and that name has a word used by
 *   at most BRAND_WORD_MAX_APPS app names in the whole database ("inaturalist",
 *   "capcut"), unlike generic names ("Habit Tracker": "habit" is in 200+ names).
 * @param appsWithWord how many tracked app names contain a word
 */
export function isBrandedTerm(term: string, resultTitles: string[], appsWithWord: (word: string) => number): boolean {
  const t = normaliseTerm(term);
  if (TITLE_PUNCTUATION.test(t)) return true;
  const termTokens = tokens(t);
  for (const title of resultTitles.slice(0, 3)) {
    const name = tokens(titleName(title));
    if (!name.length || name.length > termTokens.length) continue;
    if (!name.every((w, i) => termTokens[i] === w)) continue;
    // Count singular and plural together: "iphones" is rare, "iphone" is not.
    const uses = (w: string) => Math.max(appsWithWord(w), appsWithWord(w.replace(/s$/, '')), appsWithWord(w + 's'));
    if (name.some((w) => w.length >= 2 && uses(w) <= BRAND_WORD_MAX_APPS)) return true;
  }
  return false;
}

export type Tag = 'quick-win' | 'high-demand' | 'money-niche' | 'crowded' | 'new-apps-winning' | 'brand';

export const TAG_LABEL: Record<Tag, string> = {
  'quick-win': 'Quick win',
  'high-demand': 'High demand',
  'money-niche': 'Money niche',
  crowded: 'Crowded',
  'new-apps-winning': 'New apps ranking',
  brand: 'App name',
};

export function tagsFor(
  s: { popularity: number; difficulty: number; niche_revenue: number | null; fresh_share: number | null },
  branded = false,
): Tag[] {
  const t: Tag[] = branded ? ['brand'] : [];
  if (s.popularity >= 30 && s.difficulty < 40) t.push('quick-win');
  if (s.popularity >= 60) t.push('high-demand');
  if ((s.niche_revenue ?? 0) >= 1_000_000) t.push('money-niche');
  if ((s.fresh_share ?? 0) >= 0.3) t.push('new-apps-winning');
  if (s.difficulty >= 70) t.push('crowded');
  return t;
}
