import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  competition,
  normaliseTerm,
  opportunityScore,
  popularityScore,
  prefixesOf,
  tagsFor,
  titleMatches,
} from '../src/lib/aso/score';
import { parseHints } from '../src/lib/aso/apple';
import { createMemoryDb } from '../src/lib/db';
import { addKeyword, findHintMatch } from '../src/lib/aso/analyze';
import type { AppStoreSearch } from '../src/lib/aso/apple';

test('normalise and prefixes', () => {
  assert.equal(normaliseTerm('  Habit   Tracker '), 'habit tracker');
  assert.deepEqual(prefixesOf('ab c'), ['a', 'ab', 'ab c']); // "ab " is skipped
});

test('popularity rewards short prefixes and high positions', () => {
  const t = 'habit tracker'; // 13 chars
  const early = popularityScore(t, { prefixLength: 3, position: 1, exact: true });
  const late = popularityScore(t, { prefixLength: 10, position: 1, exact: true });
  const lowPos = popularityScore(t, { prefixLength: 3, position: 8, exact: true });
  const ext = popularityScore(t, { prefixLength: 3, position: 1, exact: false });
  assert.ok(early > late && early > lowPos && early > ext);
  assert.equal(popularityScore(t, { prefixLength: 1, position: 1, exact: true }), 100);
  assert.equal(popularityScore(t, null), 0);
  assert.equal(popularityScore(t, { prefixLength: 13, position: 10, exact: true }), 5); // floor
});

test('title matching uses whole words and prefixes', () => {
  assert.ok(titleMatches('Habit Tracker - HabitKit', 'habit tracker'));
  assert.ok(titleMatches('Habits & Tracking', 'habit track'));
  assert.ok(!titleMatches('Finch: Self-Care Pet', 'habit tracker'));
});

test('competition and opportunity', () => {
  const strong = Array.from({ length: 10 }, (_, i) => ({
    appId: i, title: 'Budget Planner', ratingCount: 1_000_000, releaseDate: '2015-01-01', monthlyRevenue: 500_000,
  }));
  const weak = Array.from({ length: 10 }, (_, i) => ({
    appId: i, title: 'Something Else', ratingCount: 9, releaseDate: '2026-09-01', monthlyRevenue: null,
  }));
  const s = competition('budget planner', strong, '2026-11-06');
  const w = competition('budget planner', weak, '2026-11-06');
  assert.equal(s.difficulty, 100);
  assert.equal(s.nicheRevenue, 5_000_000);
  assert.equal(s.top5MedianRevenue, 500_000);
  assert.equal(w.titleMatch, 0);
  assert.equal(w.freshShare, 1);
  assert.equal(w.difficulty, 0); // few ratings, no title match, all launched this year → clamped to 0
  assert.equal(competition('x', [], '2026-11-06').difficulty, 0);
  // Same demand: an open keyword beats a closed one; money breaks ties upward.
  assert.ok(opportunityScore(60, w.difficulty, 0) > opportunityScore(60, s.difficulty, s.nicheRevenue));
  assert.ok(opportunityScore(60, 30, 10_000_000) > opportunityScore(60, 30, 0));
  assert.equal(opportunityScore(100, 0, 10_000_000), 100);
});

test('tags', () => {
  assert.deepEqual(tagsFor({ popularity: 65, difficulty: 30, niche_revenue: 2e6, fresh_share: 0.4 }), [
    'quick-win', 'high-demand', 'money-niche', 'new-apps-winning',
  ]);
  assert.deepEqual(tagsFor({ popularity: 10, difficulty: 80, niche_revenue: 0, fresh_share: 0 }), ['crowded']);
});

test('autocomplete plist parsing decodes entities', () => {
  const xml = `<dict><key>term</key><string>budge: adhd planner &amp; focus</string><key>url</key><string>x</string></dict>
  <dict><key>term</key><string>habit tracker</string></dict>`;
  assert.deepEqual(parseHints(xml), ['budge: adhd planner & focus', 'habit tracker']);
});

function fakeClient(map: Record<string, string[]>): AppStoreSearch {
  return { hints: async (p: string) => map[p] ?? [] } as unknown as AppStoreSearch;
}

test('hint match: exact term, phrase extension fallback, none', async () => {
  const exact = await findHintMatch(fakeClient({ h: ['hinge'], ha: ['happ'], hab: ['the habit', 'habit tracker'] }), 'habit tracker', 'us');
  assert.deepEqual(exact, { prefixLength: 3, position: 2, exact: true });
  const ext = await findHintMatch(fakeClient({ bu: ['bumble', 'budget app'] }), 'budget', 'us');
  assert.deepEqual(ext, { prefixLength: 2, position: 2, exact: false });
  assert.equal(await findHintMatch(fakeClient({}), 'zzqx', 'us'), null);
});

test('addKeyword normalises, dedupes and validates', () => {
  const db = createMemoryDb();
  const a = addKeyword(db, ' Habit  Tracker', 'us', 'suggest', 'habit');
  const b = addKeyword(db, 'habit tracker', 'us', 'manual');
  assert.equal(a.id, b.id);
  assert.equal(b.source, 'manual'); // manual/seed outranks suggest
  assert.throws(() => addKeyword(db, 'x', 'zz', 'manual'), /not supported/);
  assert.throws(() => addKeyword(db, '   ', 'us', 'manual'), /empty/);
});

test('brand detection: punctuation, rare app names, generic titles', async () => {
  const { isBrandedTerm, titleName } = await import('../src/lib/aso/score');
  const counts: Record<string, number> = { for: 900, inaturalist: 3, habit: 202, tracker: 1032, iphone: 400, iphones: 2, fonts: 112, plant: 163, identifier: 233 };
  const df = (w: string) => counts[w] ?? 0;
  assert.equal(titleName('PDF Expert: Editor & Reader'), 'pdf expert');
  assert.ok(isBrandedTerm('huckleberry: baby tracker', [], df)); // store-title punctuation
  assert.ok(isBrandedTerm('inaturalist plant identifier', ['iNaturalist', 'PictureThis'], df));
  assert.ok(!isBrandedTerm('habit tracker', ['Habit Tracker', 'Habit Tracker - HabitKit'], df)); // generic title
  assert.ok(!isBrandedTerm('fonts for iphones free', ['Fonts for iPhones'], df)); // plural of a common word
  assert.ok(!isBrandedTerm('plant identifier', ['iNaturalist'], df)); // brand ranks, but the term does not name it
});
