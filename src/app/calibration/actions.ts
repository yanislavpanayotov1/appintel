'use server';
import { redirect } from 'next/navigation';
import { getDb } from '../../lib/db';
import { addPoint, runCalibration } from '../../lib/model/calibrate';
import { estimateAll } from '../../lib/model/estimate';
import { importTrustMrr } from '../../lib/trustmrr';

function back(kind: 'msg' | 'err', text: string): never {
  redirect(`/calibration?${kind}=${encodeURIComponent(text)}`);
}

function refit(): string {
  const db = getDb();
  const res = runCalibration(db);
  const r = estimateAll(db);
  if (!res) return `No usable points yet — estimates still use priors (${r.days} country-days recomputed).`;
  return `Fitted on ${res.nPoints} point${res.nPoints === 1 ? '' : 's'}: scale ×${res.scale.toFixed(2)}, b = ${res.b.toFixed(2)}${res.bFixed ? ' (b fixed until 3 points)' : ''}, typical error ×/÷${Math.exp(res.logRmse).toFixed(2)}. ${r.days} country-days recomputed.`;
}

export async function addPointAction(form: FormData) {
  let message: string;
  try {
    const appRaw = String(form.get('app') ?? '').trim();
    const appId = Number(appRaw.match(/id(\d{6,})/)?.[1] ?? appRaw);
    addPoint(getDb(), {
      app_id: appId,
      country: String(form.get('country') ?? 'ww').toLowerCase(),
      period_start: String(form.get('start') ?? ''),
      period_end: String(form.get('end') ?? ''),
      revenue_usd: Number(String(form.get('revenue') ?? '').replace(/[$,\s]/g, '')),
      revenue_type: String(form.get('type') ?? 'gross') as 'gross' | 'proceeds',
      source: String(form.get('source') ?? ''),
      note: String(form.get('note') ?? '') || null,
    });
    message = 'Saved. ' + refit();
  } catch (e) {
    back('err', (e as Error).message);
  }
  back('msg', message);
}

export async function importTrustMrrAction(form: FormData) {
  let message: string;
  try {
    const appRaw = String(form.get('app') ?? '').trim();
    const r = await importTrustMrr(getDb(), String(form.get('slug') ?? ''), {
      appId: appRaw ? Number(appRaw.match(/id(\d{6,})/)?.[1] ?? appRaw) : undefined,
    });
    message = `Imported ${r.name}: $${r.total.toLocaleString('en-US')} (${r.start} – ${r.end}). ` + refit();
  } catch (e) {
    back('err', (e as Error).message);
  }
  back('msg', message);
}

export async function deletePointAction(form: FormData) {
  const id = Number(form.get('id'));
  if (Number.isInteger(id)) getDb().prepare('DELETE FROM calibration_points WHERE id = ?').run(id);
  back('msg', 'Deleted. ' + refit());
}

export async function refitAction() {
  back('msg', refit());
}
