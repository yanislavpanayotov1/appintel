import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combine } from '../src/lib/aggregate';

const row = (o: Partial<Parameters<typeof combine>[0][number]>) => ({
  app_id: 1, country: 'us', avg_rev: 100, avg_lo: 50, avg_hi: 200, avg_dl: 1000, days: 30,
  rec: 120, rec_n: 7, pri: 100, pri_n: 7, conf: 1, method: 'grossing_overall' as const, calibrated: 0, ...o,
});

test('combine sums countries, computes run-rate, RPD and growth', () => {
  const m = combine([row({}), row({ country: 'gb', avg_rev: 50, avg_lo: 25, avg_hi: 100, avg_dl: 500, rec: 40, pri: 50, conf: 2 })], 30);
  const r = m.get(1)!;
  assert.equal(r.dailyRevenue, 150);
  assert.equal(r.monthlyRevenue, 4500);
  assert.equal(r.monthlyLow, 2250);
  assert.equal(r.rpd, 0.1);
  assert.ok(Math.abs(r.growth! - (160 / 150 - 1)) < 1e-12);
  assert.equal(r.confidence, 'high'); // from the top-revenue country
  assert.equal(r.topCountry, 'us');
  assert.equal(r.countries, 2);
});

test('growth needs 3+ days in each half; rows outside the window are ignored', () => {
  const m = combine([row({ rec_n: 2 }), row({ app_id: 2, days: 0 })], 7);
  assert.equal(m.get(1)!.growth, null);
  assert.equal(m.has(2), false);
});
