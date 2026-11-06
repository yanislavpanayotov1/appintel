import { fetchJson, RateLimiter } from './http';

/** Normalised app details, whichever source produced them. */
export interface AppDetails {
  appId: number;
  bundleId: string | null;
  name: string;
  developer: string | null;
  developerId: number | null;
  genreId: number | null;
  genreName: string | null;
  price: number | null;
  currency: string | null;
  ratingCount: number | null;
  ratingAvg: number | null;
  version: string | null;
  iconUrl: string | null;
  url: string | null;
  releaseDate: string | null;
}

export interface DetailsSource {
  name: string;
  fetch(country: string, appIds: number[], onProgress?: (done: number) => void): Promise<AppDetails[]>;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : null);

/** Maps an iTunes Lookup result, or an Apify row with similar or camelCase field names. */
export function normaliseDetails(r: Record<string, unknown>): AppDetails | null {
  const appId = num(r.trackId ?? r.appId ?? r.id);
  if (!appId) return null;
  const genreIds = Array.isArray(r.genreIds) ? r.genreIds : null;
  return {
    appId,
    bundleId: str(r.bundleId ?? r.appBundleId),
    name: str(r.trackName ?? r.title ?? r.name) ?? `App ${appId}`,
    developer: str(r.artistName ?? r.developer ?? r.sellerName),
    developerId: num(r.artistId ?? r.developerId),
    genreId: num(r.primaryGenreId ?? r.genreId ?? (genreIds ? genreIds[0] : null)),
    genreName: str(r.primaryGenreName ?? r.primaryGenre ?? r.genre),
    price: num(r.price),
    currency: str(r.currency),
    ratingCount: num(r.userRatingCount ?? r.ratingCount ?? r.reviews ?? r.ratings),
    ratingAvg: num(r.averageUserRating ?? r.rating ?? r.score),
    version: str(r.version),
    iconUrl: str(r.artworkUrl512 ?? r.artworkUrl100 ?? r.icon ?? r.iconUrl),
    url: str(r.trackViewUrl ?? r.url),
    releaseDate: str(r.releaseDate)?.slice(0, 10) ?? null,
  };
}

/**
 * Apple iTunes Lookup API: https://itunes.apple.com/lookup?id=1,2,3&country=us
 * Batches of 100 ids (verified to work). Apple documents ~20 calls/minute, so we
 * pace at one call every 3.2 seconds.
 */
export class AppleLookupSource implements DetailsSource {
  name = 'apple-lookup';
  private limiter = new RateLimiter(3200);
  constructor(private batchSize = 100) {}

  async fetch(country: string, appIds: number[], onProgress?: (done: number) => void): Promise<AppDetails[]> {
    const out: AppDetails[] = [];
    for (let i = 0; i < appIds.length; i += this.batchSize) {
      const batch = appIds.slice(i, i + this.batchSize);
      await this.limiter.wait();
      const url = `https://itunes.apple.com/lookup?entity=software&country=${country}&id=${batch.join(',')}`;
      const json = await fetchJson<{ results?: Record<string, unknown>[] }>(url);
      for (const r of json.results ?? []) {
        if (r.wrapperType && r.wrapperType !== 'software') continue;
        const d = normaliseDetails(r);
        if (d) out.push(d);
      }
      onProgress?.(Math.min(i + batch.length, appIds.length));
    }
    return out;
  }
}
