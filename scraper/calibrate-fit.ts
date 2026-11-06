/** Fit the top-grossing curve to all calibration points, then recompute estimates.  npm run calibrate:fit */
import { getDb } from '../src/lib/db';
import { runCalibration, loadPoints, evaluatePoint } from '../src/lib/model/calibrate';
import { estimateAll } from '../src/lib/model/estimate';
import { US_PRIOR } from '../src/lib/config';

const db = getDb();
const res = runCalibration(db);
if (!res) {
  console.log('No usable calibration points. Estimates keep using priors.');
  for (const p of loadPoints(db)) {
    const e = evaluatePoint(db, p);
    console.log(`  #${p.id} app ${p.app_id} ${p.country} ${p.period_start}..${p.period_end}: skipped — ${e.reason}`);
  }
} else {
  for (const e of res.evaluations) {
    const p = e.point;
    console.log(
      `  #${p.id} app ${p.app_id} ${p.country} ${p.period_start}..${p.period_end}: ${e.usable ? 'used' : 'skipped — ' + e.reason}`,
    );
  }
  console.log(
    `global grossing fit: scale ×${res.scale.toFixed(3)}, b = ${res.b.toFixed(3)}${res.bFixed ? ' (b fixed to prior; needs ≥ 3 points to fit)' : ''}`,
  );
  console.log(
    `  rank-1 US revenue/day: $${Math.round(US_PRIOR.grossing.A * res.scale).toLocaleString()} · points ${res.nPoints} · ln-RMSE ${res.logRmse.toFixed(3)} · MAPE ${(res.mape * 100).toFixed(1)}%`,
  );
  for (const [c, s] of Object.entries(res.countryScales))
    console.log(`  ${c}: extra scale ×${s.scale.toFixed(3)} from ${s.n} points`);
}
const r = estimateAll(db);
console.log(`recomputed ${r.rows} estimates across ${r.days} country-days`);
