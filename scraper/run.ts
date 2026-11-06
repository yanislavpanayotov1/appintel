/**
 * Daily scrape: Apple charts → apps + ranks; app details → snapshots; then estimates.
 *
 *   npm run scrape                                  # all configured countries, today (UTC)
 *   npm run scrape -- --countries us,gb             # subset of countries
 *   npm run scrape -- --genres 6014,6007            # subset of category charts (testing)
 *   npm run scrape -- --skip-details                # charts only
 *   npm run scrape -- --details-source apify        # use Apify for details (needs APIFY_TOKEN)
 */
import { getDb, type DB } from '../src/lib/db';
import { CHART_TYPES, GENRE_IDS, OVERALL, configuredCountries, type ChartType } from '../src/lib/config';
import { estimateDay } from '../src/lib/model/estimate';
import { todayUtc } from '../src/lib/model/math';
import { fetchChart, type ChartEntry } from './sources/apple-charts';
import { AppleLookupSource, type AppDetails, type DetailsSource } from './sources/details';
import { ApifySource } from './sources/apify';
import { RateLimiter } from './sources/http';

interface Args {
  countries: string[];
  genres: number[];
  date: string;
  skipDetails: boolean;
  detailsSource: 'apple' | 'apify';
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const countries = get('--countries')?.split(',').map((s) => s.trim().toLowerCase()) ?? configuredCountries();
  const genres = get('--genres')?.split(',').map(Number).filter(Number.isFinite) ?? GENRE_IDS;
  const ds = (get('--details-source') ?? process.env.APPINTEL_DETAILS_SOURCE ?? 'apple') as Args['detailsSource'];
  return {
    countries,
    genres,
    date: get('--date') ?? todayUtc(),
    skipDetails: argv.includes('--skip-details'),
    detailsSource: ds === 'apify' ? 'apify' : 'apple',
  };
}

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

function saveChart(db: DB, date: string, country: string, chart: ChartType, genreId: number, entries: ChartEntry[]) {
  const upsertApp = db.prepare(`
    INSERT INTO apps (id, bundle_id, name, developer, genre_id, genre_name, price, currency, icon_url, url, release_date, first_seen, last_seen)
    VALUES (@appId, @bundleId, @name, @developer, @genreId, @genreName, @price, @currency, @iconUrl, @url, @releaseDate, @date, @date)
    ON CONFLICT(id) DO UPDATE SET
      last_seen = MAX(apps.last_seen, excluded.last_seen),
      name = CASE WHEN apps.details_at IS NULL THEN excluded.name ELSE apps.name END,
      icon_url = COALESCE(apps.icon_url, excluded.icon_url),
      url = COALESCE(apps.url, excluded.url),
      bundle_id = COALESCE(apps.bundle_id, excluded.bundle_id),
      developer = COALESCE(apps.developer, excluded.developer),
      genre_id = COALESCE(apps.genre_id, excluded.genre_id),
      genre_name = COALESCE(apps.genre_name, excluded.genre_name)`);
  const insRank = db.prepare(
    'INSERT OR REPLACE INTO chart_ranks (date, country, chart, genre_id, rank, app_id) VALUES (?, ?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    db.prepare('DELETE FROM chart_ranks WHERE date = ? AND country = ? AND chart = ? AND genre_id = ?').run(
      date, country, chart, genreId,
    );
    for (const e of entries) {
      upsertApp.run({ ...e, date });
      insRank.run(date, country, chart, genreId, e.rank, e.appId);
    }
  })();
}

function saveDetails(db: DB, date: string, country: string, details: AppDetails[]) {
  const snap = db.prepare(`
    INSERT OR REPLACE INTO app_snapshots (date, country, app_id, price, currency, rating_count, rating_avg, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  // US details are canonical for display fields; other countries only fill gaps.
  const updApp = db.prepare(`
    UPDATE apps SET
      name = CASE WHEN @canonical OR details_at IS NULL THEN @name ELSE name END,
      bundle_id = COALESCE(@bundleId, bundle_id),
      developer = CASE WHEN @canonical OR developer IS NULL THEN COALESCE(@developer, developer) ELSE developer END,
      developer_id = COALESCE(@developerId, developer_id),
      genre_id = CASE WHEN @canonical OR genre_id IS NULL THEN COALESCE(@genreId, genre_id) ELSE genre_id END,
      genre_name = CASE WHEN @canonical OR genre_name IS NULL THEN COALESCE(@genreName, genre_name) ELSE genre_name END,
      price = CASE WHEN @canonical OR details_at IS NULL THEN COALESCE(@price, price) ELSE price END,
      currency = CASE WHEN @canonical OR details_at IS NULL THEN COALESCE(@currency, currency) ELSE currency END,
      icon_url = COALESCE(@iconUrl, icon_url),
      url = CASE WHEN @canonical OR url IS NULL THEN COALESCE(@url, url) ELSE url END,
      release_date = COALESCE(@releaseDate, release_date),
      details_at = @date
    WHERE id = @appId`);
  db.transaction(() => {
    for (const d of details) {
      snap.run(date, country, d.appId, d.price, d.currency, d.ratingCount, d.ratingAvg, d.version);
      updApp.run({ ...d, canonical: country === 'us' ? 1 : 0, date });
    }
  })();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();
  let details: DetailsSource | null = null;
  if (!args.skipDetails) {
    details = args.detailsSource === 'apify' ? new ApifySource(process.env.APIFY_TOKEN ?? '') : new AppleLookupSource();
  }

  // A run that was killed (timeout, reboot) never reached its finally block.
  db.prepare(
    `UPDATE scrape_runs SET status = 'interrupted', finished_at = COALESCE(finished_at, ?) WHERE status = 'running' AND started_at < ?`,
  ).run(new Date().toISOString(), new Date(Date.now() - 3 * 3600_000).toISOString());

  const run = db
    .prepare(`INSERT INTO scrape_runs (date, started_at, status, countries, details_source) VALUES (?, ?, 'running', ?, ?)`)
    .run(args.date, new Date().toISOString(), args.countries.join(','), details?.name ?? 'none');
  const runId = Number(run.lastInsertRowid);
  let feedsOk = 0;
  let feedsFailed = 0;
  let ranksSaved = 0;
  let appsDetailed = 0;
  const errors: string[] = [];

  log(`scrape ${args.date} · countries ${args.countries.join(',')} · ${args.genres.length} categories · details: ${details?.name ?? 'skipped'}`);
  const feedLimiter = new RateLimiter(350);

  try {
    for (const country of args.countries) {
      const seen = new Set<number>();
      for (const chart of CHART_TYPES) {
        for (const genreId of [OVERALL, ...args.genres]) {
          await feedLimiter.wait();
          try {
            const entries = await fetchChart(country, chart, genreId);
            saveChart(db, args.date, country, chart, genreId, entries);
            entries.forEach((e) => seen.add(e.appId));
            feedsOk++;
            ranksSaved += entries.length;
          } catch (e) {
            feedsFailed++;
            errors.push(`${country}/${chart}/${genreId}: ${(e as Error).message}`);
            log(`  ! feed failed ${country}/${chart}/${genreId}: ${(e as Error).message}`);
          }
        }
        log(`  ${country} ${chart}: charts saved (${seen.size} unique apps so far)`);
      }

      if (details) {
        const ids = [...seen];
        log(`  ${country}: fetching details for ${ids.length} apps via ${details.name}`);
        try {
          const rows = await details.fetch(country, ids, (n) => {
            if (n % 1000 === 0 || n === ids.length) log(`    ${n}/${ids.length}`);
          });
          saveDetails(db, args.date, country, rows);
          appsDetailed += rows.length;

          // Paid apps need a USD price for the paid-downloads method.
          if (country !== 'us') {
            const needUsd = db
              .prepare(
                `SELECT DISTINCT s.app_id FROM app_snapshots s
                 WHERE s.date = ? AND s.country = ? AND s.price > 0
                   AND NOT EXISTS (SELECT 1 FROM app_snapshots u WHERE u.app_id = s.app_id AND u.currency = 'USD')`,
              )
              .all(args.date, country) as { app_id: number }[];
            if (needUsd.length) {
              const usd = await details.fetch('us', needUsd.map((r) => r.app_id));
              saveDetails(db, args.date, 'us', usd);
              log(`    + ${usd.length} US prices for paid apps`);
            }
          }
        } catch (e) {
          errors.push(`${country}/details: ${(e as Error).message}`);
          log(`  ! details failed for ${country}: ${(e as Error).message}`);
        }
      }

      const est = estimateDay(db, args.date, country);
      const withRevenue = est.filter((e) => e.revenue !== null).length;
      log(`  ${country}: ${est.length} estimates (${withRevenue} with revenue)`);
    }
  } catch (e) {
    errors.push((e as Error).message);
    throw e;
  } finally {
    const status = errors.length === 0 ? 'ok' : feedsOk > 0 ? 'partial' : 'failed';
    db.prepare(
      `UPDATE scrape_runs SET finished_at = ?, status = ?, feeds_ok = ?, feeds_failed = ?, ranks_saved = ?, apps_detailed = ?, error = ? WHERE id = ?`,
    ).run(new Date().toISOString(), status, feedsOk, feedsFailed, ranksSaved, appsDetailed, errors.join('\n').slice(0, 4000) || null, runId);
    log(`done: ${status} · feeds ok ${feedsOk}, failed ${feedsFailed} · ranks ${ranksSaved} · details ${appsDetailed}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
