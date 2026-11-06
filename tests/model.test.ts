import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryDb } from '../src/lib/db';
import { ols, powerLaw, dateRange, addDays } from '../src/lib/model/math';
import { fitRankMap, equivalentRank } from '../src/lib/model/rankmap';
import { estimateDay, estimateAll } from '../src/lib/model/estimate';
import { addPoint, runCalibration, validatePoint } from '../src/lib/model/calibrate';
import { priorCurve, resolveCurve } from '../src/lib/model/params';
import { parseFeed } from '../scraper/sources/apple-charts';
import { normaliseDetails } from '../scraper/sources/details';
import { parseTrustMrrMarkdown } from '../src/lib/trustmrr';
import { US_PRIOR, UNMAPPED_CATEGORY_TOP_RANK } from '../src/lib/config';

const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

test('ols recovers a line', () => {
  const f = ols([1, 2, 3, 4], [3, 5, 7, 9])!;
  close(f.slope, 2);
  close(f.intercept, 1);
  close(f.rmse, 0);
  assert.equal(ols([1, 1], [2, 3]), null);
});

test('date helpers', () => {
  assert.deepEqual(dateRange('2026-02-27', '2026-03-02'), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('rank map: fitted, anchored, unmapped', () => {
  // overall = 3 * cat^1.2  → ln o = ln3 + 1.2 ln c
  const pairs = [1, 2, 4, 8].map((c) => ({ categoryRank: c, overallRank: 3 * Math.pow(c, 1.2) }));
  const fitted = fitRankMap(pairs);
  assert.equal(fitted.method, 'fitted');
  close(fitted.beta, 1.2, 1e-9);
  close(Math.exp(fitted.alpha), 3, 1e-9);

  const anchored = fitRankMap([{ categoryRank: 2, overallRank: 40 }], 1);
  assert.equal(anchored.method, 'anchored');
  close(Math.exp(anchored.alpha), 20); // 40 = A * 2^1

  const unmapped = fitRankMap([], 1.1);
  assert.equal(unmapped.method, 'unmapped');
  close(equivalentRank(unmapped, 1, 100), UNMAPPED_CATEGORY_TOP_RANK);
});

test('equivalent rank respects chart bounds', () => {
  const m = { alpha: Math.log(0.5), beta: 1, n: 5, method: 'fitted' as const };
  // 0.5 * 10 = 5, but the app is not in the overall top 100 → must be ≥ 101
  assert.equal(equivalentRank(m, 10, 100), 101);
  // never better than its category rank
  const m2 = { alpha: Math.log(0.1), beta: 1, n: 5, method: 'fitted' as const };
  assert.equal(equivalentRank(m2, 150, 0), 150);
});

function seed(db: ReturnType<typeof createMemoryDb>, date: string) {
  const ins = db.prepare('INSERT INTO apps (id, name, genre_id, price, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)');
  const rank = db.prepare('INSERT INTO chart_ranks (date, country, chart, genre_id, rank, app_id) VALUES (?, ?, ?, ?, ?, ?)');
  const snap = db.prepare('INSERT INTO app_snapshots (date, country, app_id, price, currency, rating_count) VALUES (?, ?, ?, ?, ?, ?)');
  // App 1: overall grossing #1. App 2: games category grossing #3, also overall #10.
  // App 3: games category #5 only. App 4: paid app ($4.99) on paid chart #2. App 5: free chart only.
  const apps: [number, string, number, number][] = [
    [1, 'Big', 6007, 0], [2, 'Game A', 6014, 0], [3, 'Game B', 6014, 0], [4, 'Paid', 6008, 4.99], [5, 'Free', 6013, 0],
    [6, 'Game C', 6014, 0], [7, 'Game D', 6014, 0],
  ];
  for (const [id, name, g, p] of apps) {
    ins.run(id, name, g, p, date, date);
    snap.run(date, 'us', id, p, 'USD', 1000);
  }
  rank.run(date, 'us', 'grossing', 0, 1, 1);
  rank.run(date, 'us', 'grossing', 0, 10, 2);
  rank.run(date, 'us', 'grossing', 0, 20, 6);
  rank.run(date, 'us', 'grossing', 0, 40, 7);
  rank.run(date, 'us', 'grossing', 6014, 3, 2);
  rank.run(date, 'us', 'grossing', 6014, 4, 6);
  rank.run(date, 'us', 'grossing', 6014, 5, 3);
  rank.run(date, 'us', 'grossing', 6014, 6, 7);
  rank.run(date, 'us', 'paid', 0, 2, 4);
  rank.run(date, 'us', 'free', 0, 7, 5);
}

test('estimateDay assigns methods and orders revenue sensibly', () => {
  const db = createMemoryDb();
  const date = '2026-11-01';
  seed(db, date);
  const est = new Map(estimateDay(db, date, 'us').map((e) => [e.appId, e]));
  assert.equal(est.get(1)!.method, 'grossing_overall');
  close(est.get(1)!.revenue!, US_PRIOR.grossing.A);
  assert.equal(est.get(3)!.method, 'grossing_category');
  // category #5 sits between category #4 (overall #20) and #6 (overall #40)
  const eq3 = est.get(3)!.grossingEqRank!;
  assert.ok(eq3 > 20 && eq3 < 40, `eq rank ${eq3}`);
  assert.ok(est.get(3)!.revenue! < est.get(2)!.revenue!);
  assert.equal(est.get(4)!.method, 'paid_downloads');
  close(est.get(4)!.revenue!, powerLaw(US_PRIOR.paid.A, US_PRIOR.paid.b, 2) * 4.99);
  assert.equal(est.get(5)!.method, 'downloads_rpd');
  assert.equal(est.get(5)!.confidence, 'low');
  for (const e of est.values()) {
    assert.ok(e.revenueLow! <= e.revenue! && e.revenue! <= e.revenueHigh!);
    assert.equal(e.calibrated, false);
  }
  // rank map stored for the games grossing chart (3 overlapping apps → fitted)
  const m = db.prepare(`SELECT method, n_points FROM rank_maps WHERE chart='grossing' AND genre_id=6014`).get() as { method: string; n_points: number };
  assert.equal(m.n_points, 3);
});

test('free-chart category with no overall overlap borrows the grossing map', () => {
  const db = createMemoryDb();
  const date = '2026-11-01';
  seed(db, date);
  // Games free chart, but no game in the overall free chart.
  db.prepare('INSERT INTO chart_ranks (date, country, chart, genre_id, rank, app_id) VALUES (?, ?, ?, ?, ?, ?)').run(date, 'us', 'free', 6014, 2, 3);
  const est = new Map(estimateDay(db, date, 'us').map((e) => [e.appId, e]));
  const m = db.prepare(`SELECT method FROM rank_maps WHERE chart='free' AND genre_id=6014`).get() as { method: string };
  assert.equal(m.method, 'borrowed');
  const g = db.prepare(`SELECT alpha, beta FROM rank_maps WHERE chart='grossing' AND genre_id=6014`).get() as { alpha: number; beta: number };
  close(est.get(3)!.downloadsEqRank!, Math.max(Math.exp(g.alpha + g.beta * Math.log(2)), 2, 2), 1e-9);
});

test('calibration recovers a known scale and exponent', () => {
  process.env.APPINTEL_COUNTRIES = 'us';
  const db = createMemoryDb();
  const start = '2026-10-01';
  const days = dateRange(start, '2026-10-10');
  const trueScale = 0.4;
  const trueB = 1.1;
  const rank = db.prepare('INSERT INTO chart_ranks (date, country, chart, genre_id, rank, app_id) VALUES (?, ?, ?, ?, ?, ?)');
  const appRanks: Record<number, number> = { 11: 1, 12: 5, 13: 20, 14: 60 };
  for (const id of Object.keys(appRanks)) {
    db.prepare('INSERT INTO apps (id, name, first_seen, last_seen) VALUES (?, ?, ?, ?)').run(Number(id), `App ${id}`, start, start);
  }
  for (const d of days) for (const [id, r] of Object.entries(appRanks)) rank.run(d, 'us', 'grossing', 0, r, Number(id));
  estimateAll(db);

  const A = priorCurve('us', 'grossing').A;
  for (const [id, r] of Object.entries(appRanks)) {
    addPoint(db, {
      app_id: Number(id), country: 'us', period_start: days[0], period_end: days.at(-1)!,
      revenue_usd: trueScale * A * Math.pow(r, -trueB) * days.length, revenue_type: 'gross', source: 'synthetic',
    });
  }
  const res = runCalibration(db)!;
  close(res.b, trueB, 0.01);
  close(res.scale, trueScale, 0.02);
  assert.ok(res.logRmse < 0.01);
  const curve = resolveCurve(db, 'us', 'grossing');
  assert.equal(curve.calibrated, true);
  // country with ≥ 3 own points gets a (≈1) country scale
  assert.ok(Math.abs(res.countryScales.us.scale - 1) < 0.02);

  // Re-estimating applies the fit.
  estimateAll(db);
  const e = db.prepare('SELECT revenue, calibrated FROM estimates WHERE app_id = 11 LIMIT 1').get() as { revenue: number; calibrated: number };
  assert.equal(e.calibrated, 1);
  close(e.revenue, trueScale * A, 0.03);
});

test('calibration skips points without grossing coverage; proceeds converted to gross', () => {
  const db = createMemoryDb();
  db.prepare('INSERT INTO apps (id, name, first_seen, last_seen) VALUES (99, ?, ?, ?)').run('x', '2026-01-01', '2026-01-01');
  addPoint(db, { app_id: 99, country: 'us', period_start: '2026-01-01', period_end: '2026-01-31', revenue_usd: 700, revenue_type: 'proceeds', source: 's' });
  assert.equal(runCalibration(db), null);
  assert.match(validatePoint({ app_id: 1, country: 'us', period_start: '2026-02-01', period_end: '2026-01-01', revenue_usd: 1, revenue_type: 'gross', source: 's' })!, /after/);
});

test('feed parser handles single entries and missing fields', () => {
  const one = parseFeed({ feed: { entry: { id: { attributes: { 'im:id': '123', 'im:bundleId': 'a.b' } }, 'im:name': { label: 'X' }, 'im:price': { attributes: { amount: '1.99', currency: 'USD' } } } } });
  assert.equal(one.length, 1);
  assert.equal(one[0].rank, 1);
  assert.equal(one[0].price, 1.99);
  assert.deepEqual(parseFeed({ feed: {} }), []);
});

test('details normaliser maps iTunes and camelCase rows', () => {
  const a = normaliseDetails({ trackId: 5, trackName: 'N', userRatingCount: 10, averageUserRating: 4.5, price: 0, primaryGenreId: 6014 })!;
  assert.equal(a.ratingCount, 10);
  assert.equal(a.genreId, 6014);
  const b = normaliseDetails({ appId: '7', title: 'T', ratings: '1,234', genreIds: ['6007'] })!;
  assert.equal(b.appId, 7);
  assert.equal(b.ratingCount, 1234);
  assert.equal(b.genreId, 6007);
  assert.equal(normaliseDetails({ title: 'no id' }), null);
});

test('TrustMRR markdown parser', () => {
  const md = `# My App
- Apple App Store: [App Store listing](https://apps.apple.com/us/app/id6738000856)
Apple revenue is before commission, minus refunds.
### Daily revenue — last 30 days
| Date | Verified revenue |
| --- | ---: |
| 2026-10-08 | $1,007.99 |
| 2026-10-09 | $0.00 |
### Monthly revenue timeline
| 2026-09 | $99.00 |
`;
  const p = parseTrustMrrMarkdown(md);
  assert.equal(p.appId, 6738000856);
  assert.equal(p.daily.length, 2);
  assert.equal(p.daily[0].revenue, 1007.99);
  assert.equal(p.revenueType, 'gross');
});
