import type { DB } from '../db';
import { addDays } from '../model/math';
import { AppStoreSearch, STOREFRONT, type SearchResult } from './apple';
import {
  competition,
  normaliseTerm,
  opportunityScore,
  popularityScore,
  prefixesOf,
  type HintMatch,
} from './score';

export const RANKS_KEPT = 50;

export interface KeywordRow {
  id: number;
  term: string;
  country: string;
  source: string;
  parent: string | null;
}

export function addKeyword(
  db: DB,
  term: string,
  country: string,
  source: 'seed' | 'suggest' | 'manual',
  parent: string | null = null,
): KeywordRow {
  const t = normaliseTerm(term);
  if (!t) throw new Error('Keyword is empty');
  if ([...t].length > 60) throw new Error('Keyword is longer than 60 characters');
  if (!STOREFRONT[country]) throw new Error(`Country '${country}' is not supported for keywords (${Object.keys(STOREFRONT).join(', ')})`);
  db.prepare(
    `INSERT INTO keywords (term, country, source, parent, added_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(term, country) DO UPDATE SET active = 1,
       source = CASE WHEN excluded.source IN ('seed','manual') THEN excluded.source ELSE keywords.source END`,
  ).run(t, country, source, parent, new Date().toISOString());
  return db.prepare('SELECT id, term, country, source, parent FROM keywords WHERE term = ? AND country = ?').get(t, country) as KeywordRow;
}

/**
 * Shortest prefix at which autocomplete suggests the term. If Apple never
 * suggests the term itself, the earliest suggestion that extends it as a phrase
 * ("budget" → "budget app") is used instead; the better-scoring of the two wins.
 */
export async function findHintMatch(client: AppStoreSearch, term: string, country: string): Promise<HintMatch | null> {
  const t = normaliseTerm(term);
  let exact: HintMatch | null = null;
  let extension: HintMatch | null = null;
  for (const p of prefixesOf(t)) {
    const list = await client.hints(p, country);
    const pos = list.indexOf(t);
    if (pos >= 0) {
      exact = { prefixLength: [...p].length, position: pos + 1, exact: true };
      break;
    }
    if (!extension) {
      const ext = list.findIndex((h) => h.startsWith(t + ' '));
      if (ext >= 0) extension = { prefixLength: [...p].length, position: ext + 1, exact: false };
    }
  }
  if (exact && extension) return popularityScore(t, exact) >= popularityScore(t, extension) ? exact : extension;
  return exact ?? extension;
}

/** Suggestions for a seed: what people type after it. */
export async function expandSeed(client: AppStoreSearch, seed: string, country: string): Promise<string[]> {
  const s = normaliseTerm(seed);
  const found = new Set<string>();
  for (const p of [s, s + ' ']) {
    for (const h of await client.hints(p, country)) if (h !== s) found.add(h);
  }
  return [...found];
}

function monthlyRevenueByApp(db: DB, country: string, appIds: number[], date: string): Map<number, number> {
  if (!appIds.length) return new Map();
  const latest = (db.prepare('SELECT MAX(date) d FROM estimates WHERE country = ? AND date <= ?').get(country, date) as { d: string | null }).d;
  if (!latest) return new Map();
  const rows = db
    .prepare(
      `SELECT app_id, AVG(revenue) * 30 rev FROM estimates
       WHERE country = ? AND date BETWEEN ? AND ? AND revenue IS NOT NULL AND app_id IN (${appIds.map(() => '?').join(',')})
       GROUP BY app_id`,
    )
    .all(country, addDays(latest, -29), latest, ...appIds) as { app_id: number; rev: number }[];
  return new Map(rows.map((r) => [r.app_id, r.rev]));
}

function saveResults(db: DB, date: string, country: string, keywordId: number, results: SearchResult[]) {
  const upsertApp = db.prepare(`
    INSERT INTO apps (id, bundle_id, name, developer, genre_id, genre_name, price, currency, icon_url, url, release_date, first_seen, last_seen)
    VALUES (@appId, @bundleId, @title, @developer, @genreId, @genreName, @price, @currency, @iconUrl, @url, @releaseDate, @date, @date)
    ON CONFLICT(id) DO UPDATE SET
      last_seen = MAX(apps.last_seen, excluded.last_seen),
      icon_url = COALESCE(apps.icon_url, excluded.icon_url),
      url = COALESCE(apps.url, excluded.url),
      release_date = COALESCE(apps.release_date, excluded.release_date),
      genre_id = COALESCE(apps.genre_id, excluded.genre_id),
      genre_name = COALESCE(apps.genre_name, excluded.genre_name)`);
  const snap = db.prepare(`
    INSERT OR IGNORE INTO app_snapshots (date, country, app_id, price, currency, rating_count, rating_avg)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const rank = db.prepare('INSERT OR REPLACE INTO keyword_ranks (date, keyword_id, rank, app_id) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM keyword_ranks WHERE date = ? AND keyword_id = ?').run(date, keywordId);
    results.slice(0, RANKS_KEPT).forEach((r, i) => {
      upsertApp.run({ ...r, date });
      snap.run(date, country, r.appId, r.price, r.currency, r.ratingCount, r.ratingAvg);
      rank.run(date, keywordId, i + 1, r.appId);
    });
  })();
}

export interface KeywordAnalysis {
  keywordId: number;
  term: string;
  popularity: number;
  difficulty: number;
  opportunity: number;
  results: number;
  nicheRevenue: number;
}

export async function analyzeKeyword(db: DB, client: AppStoreSearch, kw: KeywordRow, date: string): Promise<KeywordAnalysis> {
  const [match, results] = await Promise.all([
    findHintMatch(client, kw.term, kw.country),
    client.search(kw.term, kw.country),
  ]);
  saveResults(db, date, kw.country, kw.id, results);
  const rev = monthlyRevenueByApp(db, kw.country, results.slice(0, 10).map((r) => r.appId), date);
  const comp = competition(
    kw.term,
    results.map((r) => ({
      appId: r.appId,
      title: r.title,
      ratingCount: r.ratingCount,
      releaseDate: r.releaseDate,
      monthlyRevenue: rev.get(r.appId) ?? null,
    })),
    date,
  );
  const popularity = popularityScore(kw.term, match);
  const opportunity = results.length ? opportunityScore(popularity, comp.difficulty, comp.nicheRevenue) : 0;
  db.prepare(
    `INSERT OR REPLACE INTO keyword_snapshots
      (date, keyword_id, popularity, hint_prefix_len, hint_position, hint_exact, results, difficulty, rating_strength, title_match,
       charting_share, fresh_share, niche_revenue, top5_median_rev, opportunity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    date, kw.id, popularity, match?.prefixLength ?? null, match?.position ?? null, match ? (match.exact ? 1 : 0) : null, results.length, comp.difficulty,
    comp.ratingStrength, comp.titleMatch, comp.chartingShare, comp.freshShare, comp.nicheRevenue, comp.top5MedianRevenue, opportunity,
  );
  return { keywordId: kw.id, term: kw.term, popularity, difficulty: comp.difficulty, opportunity, results: results.length, nicheRevenue: comp.nicheRevenue };
}
