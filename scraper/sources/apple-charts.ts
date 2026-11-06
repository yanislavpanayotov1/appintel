import { FEED_NAME, OVERALL, type ChartType } from '../../src/lib/config';
import { fetchJson } from './http';

/**
 * Apple's legacy iTunes RSS chart feeds:
 *   https://itunes.apple.com/{country}/rss/{feed}/limit=100[/genre={id}]/json
 * Each feed returns at most 100 entries, in rank order.
 */

export interface ChartEntry {
  rank: number;
  appId: number;
  bundleId: string | null;
  name: string;
  developer: string | null;
  genreId: number | null;
  genreName: string | null;
  price: number;
  currency: string | null;
  iconUrl: string | null;
  url: string | null;
  releaseDate: string | null;
}

interface Label {
  label?: string;
  attributes?: Record<string, string>;
}
interface FeedEntry {
  'im:name'?: Label;
  'im:image'?: Label[];
  'im:price'?: Label;
  id?: Label;
  'im:artist'?: Label;
  category?: Label;
  'im:releaseDate'?: Label;
  link?: Label | Label[];
}
interface Feed {
  feed?: { entry?: FeedEntry | FeedEntry[] };
}

export function chartUrl(country: string, chart: ChartType, genreId: number): string {
  const genre = genreId === OVERALL ? '' : `/genre=${genreId}`;
  return `https://itunes.apple.com/${country}/rss/${FEED_NAME[chart]}/limit=100${genre}/json`;
}

export function parseFeed(json: Feed): ChartEntry[] {
  const raw = json.feed?.entry;
  const entries = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const out: ChartEntry[] = [];
  entries.forEach((e, i) => {
    const appId = Number(e.id?.attributes?.['im:id']);
    if (!Number.isFinite(appId) || appId <= 0) return;
    const images = e['im:image'] ?? [];
    const link = Array.isArray(e.link) ? e.link[0] : e.link;
    out.push({
      rank: i + 1,
      appId,
      bundleId: e.id?.attributes?.['im:bundleId'] ?? null,
      name: e['im:name']?.label ?? `App ${appId}`,
      developer: e['im:artist']?.label ?? null,
      genreId: e.category?.attributes?.['im:id'] ? Number(e.category.attributes['im:id']) : null,
      genreName: e.category?.attributes?.label ?? null,
      price: Number(e['im:price']?.attributes?.amount ?? 0) || 0,
      currency: e['im:price']?.attributes?.currency ?? null,
      iconUrl: images.length ? images[images.length - 1].label ?? null : null,
      url: link?.attributes?.href?.replace(/\?uo=\d+$/, '') ?? null,
      releaseDate: e['im:releaseDate']?.label?.slice(0, 10) ?? null,
    });
  });
  return out;
}

export async function fetchChart(country: string, chart: ChartType, genreId: number): Promise<ChartEntry[]> {
  return parseFeed(await fetchJson<Feed>(chartUrl(country, chart, genreId)));
}
