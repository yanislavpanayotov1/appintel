import { GENRES, type Confidence } from './config';
import type { LeaderboardFilter, SortKey } from './queries';

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export function parseWindow(v: string): 7 | 30 | 90 {
  return v === '7' ? 7 : v === '90' ? 90 : 30;
}

export function parseFilter(sp: SP, countries: string[]): LeaderboardFilter {
  const country = one(sp.country).toLowerCase();
  const genre = Number(one(sp.genre));
  const conf = one(sp.confidence) as Confidence;
  const model = one(sp.model);
  const sort = one(sp.sort) as SortKey;
  const page = Math.max(1, Math.floor(Number(one(sp.page)) || 1));
  return {
    country: countries.includes(country) ? country : 'all',
    genre: GENRES[genre] ? genre : null,
    confidence: ['high', 'medium', 'low'].includes(conf) ? conf : 'all',
    model: model === 'free' || model === 'paid' ? model : 'all',
    window: parseWindow(one(sp.window)),
    sort: (['revenue', 'growth', 'downloads', 'rpd'] as SortKey[]).includes(sort) ? sort : 'revenue',
    q: one(sp.q).slice(0, 80),
    page,
    pageSize: 50,
  };
}

/** Query string for a filter with overrides; drops defaults to keep URLs short. */
export function filterHref(base: string, f: LeaderboardFilter, over: Partial<LeaderboardFilter> = {}): string {
  const m = { ...f, ...over };
  const p = new URLSearchParams();
  if (m.country !== 'all') p.set('country', m.country);
  if (m.genre !== null) p.set('genre', String(m.genre));
  if (m.confidence !== 'all') p.set('confidence', m.confidence);
  if (m.model !== 'all') p.set('model', m.model);
  if (m.window !== 30) p.set('window', String(m.window));
  if (m.sort !== 'revenue') p.set('sort', m.sort);
  if (m.q) p.set('q', m.q);
  if (m.page > 1) p.set('page', String(m.page));
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}
