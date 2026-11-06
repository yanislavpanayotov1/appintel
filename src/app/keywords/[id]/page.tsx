import { notFound } from 'next/navigation';
import { getKeyword } from '../../../lib/aso/queries';
import { tagsFor, TAG_LABEL, TOP_N } from '../../../lib/aso/score';
import { COUNTRY_NAMES } from '../../../lib/config';
import { money, count, shortDate } from '../../../lib/format';
import { AppIcon, StatTile } from '../../../components/ui';
import { Meter } from '../../../components/Meter';
import { LineChart } from '../../../components/LineChart';
import { removeKeywordAction, rescoreKeywordAction } from '../actions';

type Params = Promise<{ id: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function KeywordPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const d = getKeyword(Number(id));
  if (!d) notFound();
  const { keyword, latest, history, results, related } = d;
  const top10 = results.slice(0, TOP_N);
  const tags = latest ? tagsFor(latest) : [];
  const typed = latest?.hint_prefix_len ? [...keyword.term].slice(0, latest.hint_prefix_len).join('') : null;
  const top5 = results.slice(0, 5);
  const earningTop5 = top5.filter((r) => (r.monthlyRevenue ?? 0) > 0).length;

  return (
    <>
      <section className="hero" style={{ paddingBottom: 20 }}>
        <p className="muted small" style={{ margin: '0 0 8px' }}>
          <a href={`/keywords?country=${keyword.country}`}>Keywords</a> · {COUNTRY_NAMES[keyword.country] ?? keyword.country.toUpperCase()}
          {keyword.parent ? ` · suggested from “${keyword.parent}”` : ''}
        </p>
        <h1 className="serif">{keyword.term}</h1>
        <div className="tags" style={{ marginTop: 8 }}>
          {tags.map((t) => <span key={t} className={`tag ${t}`}>{TAG_LABEL[t]}</span>)}
        </div>
      </section>

      {typeof sp.msg === 'string' && <div className="notice ok" role="status" style={{ marginBottom: 16 }}>{sp.msg}</div>}

      {!latest ? (
        <div className="card mist">
          <h3>Not scored yet</h3>
          <p className="muted small">It will be scored on the next keyword run.</p>
          <form action={rescoreKeywordAction}><input type="hidden" name="id" value={keyword.id} /><button className="btn" type="submit">Score now</button></form>
        </div>
      ) : (
        <>
          <div className="grid k4">
            <StatTile label="Opportunity" value={Math.round(latest.opportunity)} sub="0–100 · demand × openness × money" />
            <StatTile
              label="Popularity"
              value={Math.round(latest.popularity)}
              sub={
                typed
                  ? latest.hint_exact
                    ? `Suggested after “${typed}” (#${latest.hint_position})`
                    : `Phrases with it suggested after “${typed}”`
                  : 'Not suggested by autocomplete'
              }
            />
            <StatTile label="Difficulty" value={Math.round(latest.difficulty)} sub={`Top ${TOP_N} of ${latest.results} results`} />
            <StatTile
              label="Top 10 earn"
              value={money(latest.niche_revenue)}
              sub={latest.top5_median_rev ? `Typical top-5 app ${money(latest.top5_median_rev)}/mo` : `${earningTop5} of top 5 chart`}
            />
          </div>

          <div className="grid k2" style={{ marginTop: 16 }}>
            <div className="card">
              <h3>Why it scores this way</h3>
              <p className="muted small" style={{ marginTop: 0 }}>Difficulty components, top {TOP_N} results on {shortDate(latest.date)}</p>
              <div className="breakdown">
                <div className="row"><span>Rating strength (55%)</span><Meter value={latest.rating_strength ?? 0} label="Rating strength" invert /></div>
                <div className="row"><span>Keyword in title (25%)</span><Meter value={(latest.title_match ?? 0) * 100} label="Share with keyword in title" invert /></div>
                <div className="row"><span>Apps that chart (20%)</span><Meter value={(latest.charting_share ?? 0) * 100} label="Share with a revenue estimate" invert /></div>
                <div className="row"><span>Launched this year (lowers it)</span><Meter value={(latest.fresh_share ?? 0) * 100} label="Share launched in the last 365 days" /></div>
              </div>
            </div>
            <div className="card">
              <h3>Popularity over time</h3>
              <p className="muted small" style={{ marginTop: 0 }}>One point per keyword run</p>
              <LineChart
                label={`Popularity of ${keyword.term} over time`}
                format="count"
                height={180}
                points={history.map((h) => ({
                  date: h.date,
                  value: h.popularity,
                  extra: [
                    { k: 'Difficulty', v: String(Math.round(h.difficulty)) },
                    { k: 'Opportunity', v: String(Math.round(h.opportunity)) },
                  ],
                }))}
              />
            </div>
          </div>

          <h2 className="section serif">Who ranks for it</h2>
          <p className="muted" style={{ marginTop: -4 }}>
            Search results on {shortDate(latest.date)}, top {results.length} of {latest.results}. Revenue is this app’s estimate in{' '}
            {COUNTRY_NAMES[keyword.country] ?? keyword.country.toUpperCase()}.
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="num">Rank</th>
                  <th>App</th>
                  <th className="num">Ratings</th>
                  <th className="num">Stars</th>
                  <th>Released</th>
                  <th className="num">Revenue / month</th>
                  <th>Keyword in title</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const moved = r.previousRank === null ? null : r.previousRank - r.rank;
                  return (
                    <tr key={r.appId}>
                      <td className="num">
                        #{r.rank}
                        {moved !== null && moved !== 0 && (
                          <span className={`range delta ${moved > 0 ? 'up' : 'down'}`}>{moved > 0 ? '↑' : '↓'}{Math.abs(moved)}</span>
                        )}
                        {r.previousRank === null && history.length > 1 && <span className="range">new</span>}
                      </td>
                      <td>
                        <a href={`/app/${r.appId}`} className="appcell">
                          <AppIcon src={r.iconUrl} name={r.name} size={32} />
                          <span>
                            <span className="nm">{r.name}</span><br />
                            <span className="dev">{r.developer ?? ''}</span>
                          </span>
                        </a>
                      </td>
                      <td className="num">{count(r.ratingCount)}</td>
                      <td className="num">{r.ratingAvg ? r.ratingAvg.toFixed(1) : '—'}</td>
                      <td className="small muted tnum">{r.releaseDate ?? '—'}</td>
                      <td className="num">{r.monthlyRevenue ? money(r.monthlyRevenue) : <span className="faint">below charts</span>}</td>
                      <td className="small">{r.titleMatch ? 'Yes' : <span className="muted">No</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {top10.length > 0 && (
            <p className="muted small" style={{ marginTop: 12 }}>
              {top10.filter((r) => r.titleMatch).length} of the top {top10.length} use the full keyword in their title. Apps that don’t are
              ranking on other signals (subtitle, keyword field, downloads), which leaves room for a title-optimised newcomer.
            </p>
          )}
        </>
      )}

      {related.length > 0 && (
        <>
          <h2 className="section serif">Related keywords</h2>
          <div className="tags" style={{ gap: 8 }}>
            {related.map((r) => (
              <a key={r.id} href={`/keywords/${r.id}`} className="badge" style={{ fontSize: 13, padding: '4px 12px' }}>
                {r.term} <span className="muted tnum">· {Math.round(r.opportunity)}</span>
              </a>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 40, flexWrap: 'wrap' }}>
        <form action={rescoreKeywordAction}><input type="hidden" name="id" value={keyword.id} /><button className="btn ghost" type="submit">Rescore now</button></form>
        <form action={removeKeywordAction}><input type="hidden" name="id" value={keyword.id} /><button className="btn ghost" type="submit">Stop tracking</button></form>
      </div>
    </>
  );
}
