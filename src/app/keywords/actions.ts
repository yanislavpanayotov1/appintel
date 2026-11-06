'use server';
import { redirect } from 'next/navigation';
import { getDb } from '../../lib/db';
import { todayUtc } from '../../lib/model/math';
import { AppStoreSearch } from '../../lib/aso/apple';
import { addKeyword, analyzeKeyword, expandSeed } from '../../lib/aso/analyze';

/** Track a keyword (and optionally its autocomplete suggestions) and score it now. */
export async function addKeywordAction(form: FormData) {
  const raw = String(form.get('term') ?? '');
  const country = String(form.get('country') ?? 'us').toLowerCase();
  const withSuggestions = form.get('expand') === 'on';
  let target: string;
  try {
    const terms = raw.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 5);
    if (!terms.length) throw new Error('Enter a keyword');
    const db = getDb();
    const client = new AppStoreSearch();
    const date = todayUtc();
    let firstId = 0;
    let suggestions = 0;
    for (const term of terms) {
      const kw = addKeyword(db, term, country, 'manual');
      await analyzeKeyword(db, client, kw, date);
      if (!firstId) firstId = kw.id;
      if (withSuggestions) {
        // Track up to 8 suggestions per keyword; they are scored in the next `npm run keywords`.
        for (const s of (await expandSeed(client, kw.term, country)).slice(0, 8)) {
          addKeyword(db, s, country, 'suggest', kw.term);
          suggestions++;
        }
      }
    }
    target =
      terms.length === 1
        ? `/keywords/${firstId}${suggestions ? `?msg=${encodeURIComponent(`Added ${suggestions} suggestion${suggestions === 1 ? '' : 's'}; scored on the next keyword run.`)}` : ''}`
        : `/keywords?country=${country}&msg=${encodeURIComponent(`Scored ${terms.length} keywords${suggestions ? ` and queued ${suggestions} suggestion${suggestions === 1 ? '' : 's'}` : ''}.`)}`;
  } catch (e) {
    target = `/keywords?country=${country}&err=${encodeURIComponent((e as Error).message)}`;
  }
  redirect(target);
}

export async function removeKeywordAction(form: FormData) {
  const id = Number(form.get('id'));
  const row = getDb().prepare('SELECT country, term FROM keywords WHERE id = ?').get(id) as { country: string; term: string } | undefined;
  if (row) getDb().prepare('UPDATE keywords SET active = 0 WHERE id = ?').run(id);
  redirect(`/keywords?country=${row?.country ?? 'us'}&msg=${encodeURIComponent(row ? `Stopped tracking “${row.term}”.` : 'Keyword not found.')}`);
}

export async function rescoreKeywordAction(form: FormData) {
  const id = Number(form.get('id'));
  const db = getDb();
  const kw = db.prepare('SELECT id, term, country, source, parent FROM keywords WHERE id = ?').get(id) as
    | { id: number; term: string; country: string; source: string; parent: string | null }
    | undefined;
  if (!kw) redirect('/keywords');
  let msg = 'Rescored with today’s search results.';
  try {
    await analyzeKeyword(db, new AppStoreSearch(), kw, todayUtc());
  } catch (e) {
    msg = `Rescoring failed: ${(e as Error).message}`;
  }
  redirect(`/keywords/${id}?msg=${encodeURIComponent(msg)}`);
}
