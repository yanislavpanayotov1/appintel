/**
 * Import verified revenue from a public TrustMRR profile as a calibration point.
 *   npm run calibrate:trustmrr -- <slug> [--app <appStoreId>] [--type gross|proceeds]
 *
 * Takes the profile's "Daily revenue — last 30 days" table (summed) and the App Store id
 * from its App Store link. Revenue is worldwide, so the point is stored with country 'ww'.
 * Only apps that also hold a top-grossing rank during that window help calibration.
 */
import { getDb } from '../src/lib/db';
import { importTrustMrr } from '../src/lib/trustmrr';

const a = process.argv.slice(2);
const slug = a[0];
const get = (f: string) => {
  const i = a.indexOf(f);
  return i >= 0 ? a[i + 1] : undefined;
};
if (!slug || slug.startsWith('--')) {
  console.error('usage: npm run calibrate:trustmrr -- <slug> [--app <appStoreId>] [--type gross|proceeds]');
  process.exit(1);
}
importTrustMrr(getDb(), slug, {
  appId: get('--app') ? Number(get('--app')) : undefined,
  revenueType: get('--type') as 'gross' | 'proceeds' | undefined,
})
  .then((r) =>
    console.log(
      `saved #${r.id}: ${r.name} (app ${r.appId}) $${r.total.toFixed(2)} ${r.start}..${r.end} (${r.revenueType}). Run "npm run calibrate:fit".`,
    ),
  )
  .catch((e) => {
    console.error('error:', (e as Error).message);
    process.exit(1);
  });
