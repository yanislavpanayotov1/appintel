/**
 * Keyword research run: seeds → autocomplete expansion → search ranks + scores.
 *
 *   npm run keywords                                    # default seeds, US, expand suggestions
 *   npm run keywords -- --seeds "habit tracker,budget"  # your own seeds (added to the tracked list)
 *   npm run keywords -- --countries us,gb --max 150
 *   npm run keywords -- --no-expand                     # re-score tracked keywords only
 *
 * Run after `npm run scrape` so the revenue of ranking apps is current.
 * Pacing: ~3.2 s per keyword (Apple Search API limit) plus a few autocomplete calls.
 */
import { getDb } from '../src/lib/db';
import { todayUtc } from '../src/lib/model/math';
import { AppStoreSearch, STOREFRONT } from '../src/lib/aso/apple';
import { addKeyword, analyzeKeyword, expandSeed, type KeywordRow } from '../src/lib/aso/analyze';
import { DEFAULT_SEEDS } from '../src/lib/aso/seeds';

const a = process.argv.slice(2);
const get = (f: string) => {
  const i = a.indexOf(f);
  return i >= 0 ? a[i + 1] : undefined;
};
const countries = (get('--countries') ?? 'us').split(',').map((c) => c.trim().toLowerCase()).filter((c) => STOREFRONT[c]);
const seedArg = get('--seeds');
const max = Number(get('--max') ?? 400);
const expand = !a.includes('--no-expand');
const date = get('--date') ?? todayUtc();
const log = (...x: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...x);

async function main() {
  const db = getDb();
  const client = new AppStoreSearch();
  for (const country of countries) {
    const seeds = seedArg ? seedArg.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_SEEDS[country] ?? DEFAULT_SEEDS.us;
    for (const s of seeds) addKeyword(db, s, country, 'seed');

    if (expand) {
      const seedRows = db
        .prepare(`SELECT term FROM keywords WHERE country = ? AND active = 1 AND source IN ('seed','manual')`)
        .all(country) as { term: string }[];
      let added = 0;
      for (const { term } of seedRows) {
        try {
          for (const sug of await expandSeed(client, term, country)) {
            addKeyword(db, sug, country, 'suggest', term);
            added++;
          }
        } catch (e) {
          log(`  ! expand failed for "${term}": ${(e as Error).message}`);
        }
      }
      log(`${country}: ${seedRows.length} seeds expanded → ${added} suggestions`);
    }

    // Seeds and manual first, then suggestions; skip keywords already scored today.
    const list = db
      .prepare(
        `SELECT k.id, k.term, k.country, k.source, k.parent FROM keywords k
         WHERE k.country = ? AND k.active = 1
           AND NOT EXISTS (SELECT 1 FROM keyword_snapshots s WHERE s.keyword_id = k.id AND s.date = ?)
         ORDER BY CASE k.source WHEN 'manual' THEN 0 WHEN 'seed' THEN 1 ELSE 2 END, k.id
         LIMIT ?`,
      )
      .all(country, date, max) as KeywordRow[];
    log(`${country}: scoring ${list.length} keywords (≈${Math.ceil((list.length * 3.4) / 60)} min)`);
    let done = 0;
    let failed = 0;
    for (const kw of list) {
      try {
        const r = await analyzeKeyword(db, client, kw, date);
        done++;
        if (done % 25 === 0 || done === list.length)
          log(`  ${done}/${list.length} · last: "${r.term}" pop ${r.popularity} diff ${r.difficulty} opp ${r.opportunity}`);
      } catch (e) {
        failed++;
        log(`  ! "${kw.term}": ${(e as Error).message}`);
      }
    }
    log(`${country}: done ${done}, failed ${failed} · autocomplete calls ${client.hintCalls}, search calls ${client.searchCalls}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
