/** Recompute estimates for every scraped day (e.g. after changing priors).  npm run estimate [-- --since 2026-10-01] */
import { getDb } from '../src/lib/db';
import { estimateAll } from '../src/lib/model/estimate';

const i = process.argv.indexOf('--since');
const r = estimateAll(getDb(), { since: i >= 0 ? process.argv[i + 1] : undefined });
console.log(`recomputed ${r.rows} estimates across ${r.days} country-days`);
