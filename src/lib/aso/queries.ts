import 'server-only';
import { getDb } from '../db';
import { addDays } from '../model/math';
import { tagsFor, titleMatches, type Tag } from './score';

export interface KeywordListRow {
  id: number;
  term: string;
  country: string;
  source: string;
  parent: string | null;
  date: string;
  popularity: number;
  difficulty: number;
  opportunity: number;
  results: number;
  nicheRevenue: number;
  top5MedianRevenue: number;
  titleMatch: number;
  freshShare: number;
  hintPrefixLen: number | null;
  hintPosition: number | null;
  hintExact: boolean | null;
  popularityChange: number | null; // vs a snapshot ≥ 7 days earlier
  topApp: { id: number; name: string; iconUrl: string | null } | null;
  tags: Tag[];
}

export type KeywordSort = 'opportunity' | 'popularity' | 'difficulty' | 'niche' | 'potential';

export interface KeywordFilter {
  country: string;
  q: string;
  minPopularity: number;
  maxDifficulty: number;
  tag: Tag | 'all';
  sort: KeywordSort;
}

interface SnapRow {
  id: number;
  term: string;
  country: string;
  source: string;
  parent: string | null;
  date: string;
  popularity: number;
  difficulty: number;
  opportunity: number;
  results: number;
  niche_revenue: number | null;
  top5_median_rev: number | null;
  title_match: number | null;
  fresh_share: number | null;
  hint_prefix_len: number | null;
  hint_position: number | null;
  hint_exact: number | null;
  prev_pop: number | null;
}

export function keywordCountries(): string[] {
  return (getDb().prepare('SELECT DISTINCT country FROM keywords ORDER BY country').all() as { country: string }[]).map((r) => r.country);
}

export function getKeywordList(f: KeywordFilter): KeywordListRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `WITH latest AS (
         SELECT keyword_id, MAX(date) d FROM keyword_snapshots GROUP BY keyword_id
       )
       SELECT k.id, k.term, k.country, k.source, k.parent, s.date, s.popularity, s.difficulty, s.opportunity, s.results,
              s.niche_revenue, s.top5_median_rev, s.title_match, s.fresh_share, s.hint_prefix_len, s.hint_position, s.hint_exact,
              (SELECT p.popularity FROM keyword_snapshots p WHERE p.keyword_id = k.id AND p.date <= date(s.date, '-7 day')
                 ORDER BY p.date DESC LIMIT 1) prev_pop
       FROM keywords k JOIN latest l ON l.keyword_id = k.id
       JOIN keyword_snapshots s ON s.keyword_id = k.id AND s.date = l.d
       WHERE k.active = 1 AND k.country = ?`,
    )
    .all(f.country) as SnapRow[];

  const topStmt = db.prepare(
    `SELECT a.id, a.name, a.icon_url iconUrl FROM keyword_ranks r JOIN apps a ON a.id = r.app_id
     WHERE r.keyword_id = ? AND r.date = ? AND r.rank = 1`,
  );
  const q = f.q.trim().toLowerCase();
  const out: KeywordListRow[] = [];
  for (const r of rows) {
    if (q && !r.term.includes(q)) continue;
    if (r.popularity < f.minPopularity || r.difficulty > f.maxDifficulty) continue;
    const tags = tagsFor(r);
    if (f.tag !== 'all' && !tags.includes(f.tag)) continue;
    const top = topStmt.get(r.id, r.date) as { id: number; name: string; iconUrl: string | null } | undefined;
    out.push({
      id: r.id,
      term: r.term,
      country: r.country,
      source: r.source,
      parent: r.parent,
      date: r.date,
      popularity: r.popularity,
      difficulty: r.difficulty,
      opportunity: r.opportunity,
      results: r.results,
      nicheRevenue: r.niche_revenue ?? 0,
      top5MedianRevenue: r.top5_median_rev ?? 0,
      titleMatch: r.title_match ?? 0,
      freshShare: r.fresh_share ?? 0,
      hintPrefixLen: r.hint_prefix_len,
      hintPosition: r.hint_position,
      hintExact: r.hint_exact === null ? null : r.hint_exact === 1,
      popularityChange: r.prev_pop === null ? null : r.popularity - r.prev_pop,
      topApp: top ?? null,
      tags,
    });
  }
  const key: Record<KeywordSort, (r: KeywordListRow) => number> = {
    opportunity: (r) => r.opportunity,
    popularity: (r) => r.popularity,
    difficulty: (r) => -r.difficulty,
    niche: (r) => r.nicheRevenue,
    potential: (r) => r.top5MedianRevenue,
  };
  return out.sort((a, b) => key[f.sort](b) - key[f.sort](a) || b.opportunity - a.opportunity);
}

/** Best picks: highest opportunity among keywords with real demand, one per close variant. */
export function bestPicks(rows: KeywordListRow[], n = 10): KeywordListRow[] {
  const picked: KeywordListRow[] = [];
  for (const r of [...rows].sort((a, b) => b.opportunity - a.opportunity)) {
    if (r.popularity < 20 || r.results < 10) continue;
    // Skip near-duplicates ("habit tracker" vs "habit tracker app").
    if (picked.some((p) => r.term.startsWith(p.term + ' ') || p.term.startsWith(r.term + ' '))) continue;
    picked.push(r);
    if (picked.length === n) break;
  }
  return picked;
}

export function pickReason(r: KeywordListRow): string {
  const parts: string[] = [];
  if (r.hintPrefixLen !== null) {
    const typed = [...r.term].slice(0, r.hintPrefixLen).join('');
    parts.push(
      r.hintExact
        ? `Suggested after typing “${typed}” (#${r.hintPosition})`
        : `Phrases starting with it are suggested after “${typed}”`,
    );
  }
  if (r.difficulty < 40) parts.push('top results have few ratings');
  else if (r.difficulty < 60) parts.push('moderate competition');
  if (r.titleMatch <= 0.4) parts.push(`only ${Math.round(r.titleMatch * 10)} of the top 10 target it in their title`);
  if (r.freshShare >= 0.3) parts.push(`${Math.round(r.freshShare * 10)} of the top 10 launched this year`);
  return parts.join(' · ');
}

/* -------------------------------------------------------------------------- */

export interface KeywordDetail {
  keyword: { id: number; term: string; country: string; source: string; parent: string | null; added_at: string };
  latest: (SnapRow & { rating_strength: number | null; charting_share: number | null }) | null;
  history: { date: string; popularity: number; difficulty: number; opportunity: number }[];
  results: {
    rank: number;
    previousRank: number | null;
    appId: number;
    name: string;
    developer: string | null;
    iconUrl: string | null;
    genreName: string | null;
    ratingCount: number | null;
    ratingAvg: number | null;
    releaseDate: string | null;
    monthlyRevenue: number | null;
    titleMatch: boolean;
  }[];
  related: { id: number; term: string; opportunity: number; popularity: number }[];
}

export function getKeyword(id: number): KeywordDetail | null {
  const db = getDb();
  const keyword = db.prepare('SELECT id, term, country, source, parent, added_at FROM keywords WHERE id = ?').get(id) as
    | KeywordDetail['keyword']
    | undefined;
  if (!keyword) return null;
  const latest = db
    .prepare(
      `SELECT k.id, k.term, k.country, k.source, k.parent, s.*, NULL prev_pop
       FROM keyword_snapshots s JOIN keywords k ON k.id = s.keyword_id WHERE s.keyword_id = ? ORDER BY s.date DESC LIMIT 1`,
    )
    .get(id) as KeywordDetail['latest'] | undefined;
  const history = db
    .prepare('SELECT date, popularity, difficulty, opportunity FROM keyword_snapshots WHERE keyword_id = ? ORDER BY date')
    .all(id) as KeywordDetail['history'];
  let results: KeywordDetail['results'] = [];
  if (latest) {
    const prevDate = (
      db.prepare('SELECT MAX(date) d FROM keyword_ranks WHERE keyword_id = ? AND date < ?').get(id, latest.date) as { d: string | null }
    ).d;
    const prev = new Map<number, number>();
    if (prevDate)
      for (const r of db.prepare('SELECT app_id, rank FROM keyword_ranks WHERE keyword_id = ? AND date = ?').all(id, prevDate) as {
        app_id: number;
        rank: number;
      }[])
        prev.set(r.app_id, r.rank);
    const estLatest = (db.prepare('SELECT MAX(date) d FROM estimates WHERE country = ?').get(keyword.country) as { d: string | null }).d;
    const rows = db
      .prepare(
        `SELECT r.rank, r.app_id appId, a.name, a.developer, a.icon_url iconUrl, a.genre_name genreName, a.release_date releaseDate,
                sn.rating_count ratingCount, sn.rating_avg ratingAvg,
                (SELECT AVG(e.revenue) * 30 FROM estimates e WHERE e.app_id = r.app_id AND e.country = @country
                   AND e.date BETWEEN @from AND @to AND e.revenue IS NOT NULL) monthlyRevenue
         FROM keyword_ranks r JOIN apps a ON a.id = r.app_id
         LEFT JOIN app_snapshots sn ON sn.app_id = r.app_id AND sn.country = @country
           AND sn.date = (SELECT MAX(date) FROM app_snapshots x WHERE x.app_id = r.app_id AND x.country = @country)
         WHERE r.keyword_id = @id AND r.date = @date ORDER BY r.rank`,
      )
      .all({
        id,
        date: latest.date,
        country: keyword.country,
        from: estLatest ? addDays(estLatest, -29) : '0000-00-00',
        to: estLatest ?? '9999-12-31',
      }) as Omit<KeywordDetail['results'][number], 'previousRank' | 'titleMatch'>[];
    results = rows.map((r) => ({ ...r, previousRank: prev.get(r.appId) ?? null, titleMatch: titleMatches(r.name, keyword.term) }));
  }
  const root = keyword.parent ?? keyword.term;
  const related = db
    .prepare(
      `SELECT k.id, k.term, s.opportunity, s.popularity FROM keywords k
       JOIN keyword_snapshots s ON s.keyword_id = k.id AND s.date = (SELECT MAX(date) FROM keyword_snapshots WHERE keyword_id = k.id)
       WHERE k.country = ? AND k.id != ? AND (k.parent = ? OR k.term = ?)
       ORDER BY s.opportunity DESC LIMIT 12`,
    )
    .all(keyword.country, id, root, root) as KeywordDetail['related'];
  return { keyword, latest: latest ?? null, history, results, related };
}

export interface AppKeywordRow {
  keywordId: number;
  term: string;
  country: string;
  rank: number;
  previousRank: number | null;
  popularity: number;
  difficulty: number;
  opportunity: number;
  date: string;
}

export function getAppKeywords(appId: number): AppKeywordRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT k.id keywordId, k.term, k.country, r.rank, r.date, s.popularity, s.difficulty, s.opportunity,
              (SELECT p.rank FROM keyword_ranks p WHERE p.keyword_id = r.keyword_id AND p.app_id = r.app_id AND p.date < r.date
                 ORDER BY p.date DESC LIMIT 1) previousRank
       FROM keyword_ranks r
       JOIN keywords k ON k.id = r.keyword_id
       JOIN keyword_snapshots s ON s.keyword_id = r.keyword_id AND s.date = r.date
       WHERE r.app_id = ? AND r.date = (SELECT MAX(date) FROM keyword_ranks x WHERE x.keyword_id = r.keyword_id)
       ORDER BY s.popularity DESC, r.rank`,
    )
    .all(appId) as AppKeywordRow[];
}
