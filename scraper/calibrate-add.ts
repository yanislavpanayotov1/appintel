/**
 * Add a ground-truth revenue figure for a known app.
 *   npm run calibrate:add -- --app 1621328561 --country us --from 2026-10-01 --to 2026-10-31 \
 *        --revenue 125000 --type gross --source "founder post https://..."
 * --country ww = revenue across all tracked countries. --type proceeds = after Apple's commission.
 */
import { getDb } from '../src/lib/db';
import { addPoint } from '../src/lib/model/calibrate';

const a = process.argv.slice(2);
const get = (f: string) => {
  const i = a.indexOf(f);
  return i >= 0 ? a[i + 1] : undefined;
};
try {
  const id = addPoint(getDb(), {
    app_id: Number(get('--app')),
    country: (get('--country') ?? 'ww').toLowerCase(),
    period_start: get('--from') ?? '',
    period_end: get('--to') ?? '',
    revenue_usd: Number(get('--revenue')),
    revenue_type: (get('--type') ?? 'gross') as 'gross' | 'proceeds',
    source: get('--source') ?? '',
    note: get('--note') ?? null,
  });
  console.log(`saved calibration point #${id}. Run "npm run calibrate:fit" to refit.`);
} catch (e) {
  console.error('error:', (e as Error).message);
  process.exit(1);
}
