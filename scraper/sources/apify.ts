import { fetchJson, sleep } from './http';
import { normaliseDetails, type AppDetails, type DetailsSource } from './details';

/**
 * Optional details source via Apify. Default actor:
 *   automation-lab/apple-app-store-scraper  (input: mode='details', appIds, country, maxItems)
 * Input schema read from the actor's latest build on 2026-11-06. The actor
 * does NOT offer a top-grossing chart, so charts always come from Apple's feeds.
 *
 * Output field names are mapped defensively by normaliseDetails(); verify with
 * a small run (`npm run scrape -- --countries us --limit-apps 20`) before relying on it.
 * Apify bills per result (pay-per-event), unlike Apple's free Lookup API.
 */
export class ApifySource implements DetailsSource {
  name = 'apify';
  private base = 'https://api.apify.com/v2';

  constructor(
    private token: string,
    private actor = process.env.APIFY_ACTOR ?? 'automation-lab~apple-app-store-scraper',
    private chunk = 500,
  ) {
    if (!token) throw new Error('APIFY_TOKEN is not set');
  }

  private headers() {
    return { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' };
  }

  async fetch(country: string, appIds: number[], onProgress?: (done: number) => void): Promise<AppDetails[]> {
    const out: AppDetails[] = [];
    for (let i = 0; i < appIds.length; i += this.chunk) {
      const ids = appIds.slice(i, i + this.chunk);
      const input = { mode: 'details', appIds: ids.map(String), country, maxItems: ids.length };
      const run = await fetchJson<{ data: { id: string; defaultDatasetId: string } }>(
        `${this.base}/acts/${this.actor}/runs`,
        { init: { method: 'POST', headers: this.headers(), body: JSON.stringify(input) }, retries: 2 },
      );
      const runId = run.data.id;
      let status = 'RUNNING';
      const started = Date.now();
      while (['READY', 'RUNNING'].includes(status)) {
        await sleep(5000);
        const r = await fetchJson<{ data: { status: string } }>(`${this.base}/actor-runs/${runId}`, {
          init: { headers: this.headers() },
        });
        status = r.data.status;
        if (Date.now() - started > 30 * 60_000) throw new Error(`Apify run ${runId} exceeded 30 minutes`);
      }
      if (status !== 'SUCCEEDED') throw new Error(`Apify run ${runId} ended with status ${status}`);
      const items = await fetchJson<Record<string, unknown>[]>(
        `${this.base}/datasets/${run.data.defaultDatasetId}/items?clean=true&format=json`,
        { init: { headers: this.headers() } },
      );
      for (const item of items) {
        const d = normaliseDetails(item);
        if (d) out.push(d);
      }
      onProgress?.(Math.min(i + ids.length, appIds.length));
    }
    return out;
  }
}
