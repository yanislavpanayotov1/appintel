import { RateLimiter, USER_AGENT, sleep } from '../http';
import { normaliseTerm } from './score';

/**
 * App Store storefront ids (X-Apple-Store-Front) — each verified on 2026-11-06
 * to return localised autocomplete for its country.
 */
export const STOREFRONT: Record<string, number> = {
  us: 143441,
  gb: 143444,
  de: 143443,
  fr: 143442,
  jp: 143462,
  ca: 143455,
  au: 143460,
};

export interface SearchResult {
  appId: number;
  title: string;
  developer: string | null;
  bundleId: string | null;
  genreId: number | null;
  genreName: string | null;
  price: number;
  currency: string | null;
  ratingCount: number;
  ratingAvg: number | null;
  iconUrl: string | null;
  url: string | null;
  releaseDate: string | null;
  updatedAt: string | null;
}

async function getText(url: string, headers: Record<string, string> = {}, retries = 3): Promise<string> {
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, ...headers }, signal: ctrl.signal });
      const body = await res.text();
      if (res.ok) return body;
      last = new Error(`HTTP ${res.status} for ${url}`);
      if (res.status !== 429 && res.status < 500) throw last;
    } catch (e) {
      last = e;
      if (e instanceof Error && /HTTP 4\d\d/.test(e.message) && !/HTTP 429/.test(e.message)) throw e;
    } finally {
      clearTimeout(t);
    }
    if (i < retries) await sleep(2000 * 2 ** i);
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** Parse the autocomplete plist: the <string> after each <key>term</key>. */
export function parseHints(xml: string): string[] {
  const out: string[] = [];
  const re = /<key>term<\/key>\s*<string>([^<]*)<\/string>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(decodeXml(m[1]));
  return out;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

/**
 * Client for App Store autocomplete and search, with per-run caching and pacing.
 * Search uses Apple's documented iTunes Search API (~20 calls/minute → one per 3.2 s).
 * Autocomplete is undocumented; we pace it at 4 calls a second.
 */
export class AppStoreSearch {
  private hintCache = new Map<string, string[]>();
  private hintLimiter = new RateLimiter(250);
  private searchLimiter = new RateLimiter(3200);
  hintCalls = 0;
  searchCalls = 0;

  async hints(prefix: string, country: string): Promise<string[]> {
    const sf = STOREFRONT[country];
    if (!sf) throw new Error(`No storefront id for country '${country}'`);
    const key = `${country}|${prefix}`;
    const hit = this.hintCache.get(key);
    if (hit) return hit;
    await this.hintLimiter.wait();
    this.hintCalls++;
    const url = `https://search.itunes.apple.com/WebObjects/MZSearchHints.woa/wa/hints?clientApplication=Software&term=${encodeURIComponent(prefix)}`;
    const list = parseHints(await getText(url, { 'X-Apple-Store-Front': `${sf}-1,29` })).map(normaliseTerm);
    this.hintCache.set(key, list);
    return list;
  }

  async search(term: string, country: string, limit = 200): Promise<SearchResult[]> {
    await this.searchLimiter.wait();
    this.searchCalls++;
    const url = `https://itunes.apple.com/search?entity=software&country=${country}&limit=${limit}&term=${encodeURIComponent(term)}`;
    const json = JSON.parse(await getText(url)) as { results?: Record<string, unknown>[] };
    const out: SearchResult[] = [];
    for (const r of json.results ?? []) {
      const id = Number(r.trackId);
      if (!id || (r.wrapperType && r.wrapperType !== 'software')) continue;
      out.push({
        appId: id,
        title: String(r.trackName ?? `App ${id}`),
        developer: (r.artistName as string) ?? null,
        bundleId: (r.bundleId as string) ?? null,
        genreId: r.primaryGenreId ? Number(r.primaryGenreId) : null,
        genreName: (r.primaryGenreName as string) ?? null,
        price: Number(r.price ?? 0) || 0,
        currency: (r.currency as string) ?? null,
        ratingCount: Number(r.userRatingCount ?? 0) || 0,
        ratingAvg: r.averageUserRating !== undefined ? Number(r.averageUserRating) : null,
        iconUrl: ((r.artworkUrl512 ?? r.artworkUrl100) as string) ?? null,
        url: (r.trackViewUrl as string) ?? null,
        releaseDate: typeof r.releaseDate === 'string' ? r.releaseDate.slice(0, 10) : null,
        updatedAt: typeof r.currentVersionReleaseDate === 'string' ? r.currentVersionReleaseDate.slice(0, 10) : null,
      });
    }
    return out;
  }
}
