import { bestPicks, getKeywordList, keywordCountries, pickReason, type KeywordFilter, type KeywordSort } from '../../lib/aso/queries';
import { STOREFRONT } from '../../lib/aso/apple';
import { TAG_LABEL, type Tag } from '../../lib/aso/score';
import { COUNTRY_NAMES } from '../../lib/config';
import { money, count, shortDate } from '../../lib/format';
import { AppIcon, StatTile } from '../../components/ui';
import { Meter } from '../../components/Meter';
import { addKeywordAction } from './actions';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function KeywordsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const countries = keywordCountries();
  const country = countries.includes(one(sp.country)) ? one(sp.country) : countries.includes('us') ? 'us' : countries[0] ?? 'us';
  const sort = (['opportunity', 'popularity', 'difficulty', 'niche', 'potential'] as KeywordSort[]).includes(one(sp.sort) as KeywordSort)
    ? (one(sp.sort) as KeywordSort)
    : 'opportunity';
  const tag = (Object.keys(TAG_LABEL) as Tag[]).includes(one(sp.tag) as Tag) ? (one(sp.tag) as Tag) : 'all';
  const f: KeywordFilter = {
    country,
    q: one(sp.q).slice(0, 60),
    minPopularity: Number(one(sp.minpop)) || 0,
    maxDifficulty: one(sp.maxdiff) ? Number(one(sp.maxdiff)) : 100,
    tag,
    sort,
  };
  const all = getKeywordList({ ...f, q: '', minPopularity: 0, maxDifficulty: 100, tag: 'all', sort: 'opportunity' });
  const rows = getKeywordList(f);
  const picks = bestPicks(all, 12);
  const latest = all.reduce<string | null>((m, r) => (!m || r.date > m ? r.date : m), null);
  const quickWins = all.filter((r) => r.tags.includes('quick-win')).length;
  const filtered = f.q || f.minPopularity > 0 || f.maxDifficulty < 100 || f.tag !== 'all';

  return (
    <>
      <section className="hero">
        <h1 className="serif">Keyword opportunities</h1>
        <p>
          What people search for on the App Store, how strong the apps ranking for it are, and how much those apps earn. The best
          picks have real demand and beatable competition.
        </p>
      </section>

      {one(sp.msg) && <div className="notice ok" role="status" style={{ marginBottom: 16 }}>{one(sp.msg)}</div>}
      {one(sp.err) && <div className="notice err" role="alert" style={{ marginBottom: 16 }}>{one(sp.err)}</div>}

      <div className="grid k4">
        <StatTile label="Keywords tracked" value={count(all.length)} sub={COUNTRY_NAMES[country] ?? country.toUpperCase()} />
        <StatTile label="Top pick" value={picks[0] ? <a href={`/keywords/${picks[0].id}`} className="serif" style={{ fontWeight: 400 }}>{picks[0].term}</a> : '—'} sub={picks[0] ? `Opportunity ${Math.round(picks[0].opportunity)}` : 'Run npm run keywords'} />
        <StatTile label="Quick wins" value={count(quickWins)} sub="Popularity ≥ 30, difficulty < 40" />
        <StatTile label="Last scored" value={latest ? shortDate(latest) : '—'} sub="Re-run daily to see trends" />
      </div>

      <h2 className="section serif">Best picks</h2>
      {picks.length === 0 ? (
        <div className="card mist">
          <h3>No scored keywords yet</h3>
          <p className="muted small" style={{ margin: 0 }}>
            Run <code className="k">npm run keywords</code>, or add a keyword below.
          </p>
        </div>
      ) : (
        <div className="picks">
          {picks.map((p, i) => (
            <a key={p.id} href={`/keywords/${p.id}`} className="pick">
              <span className="n tnum">{i + 1}</span>
              <span className="kw">{p.term}</span>
              <span className="score tnum">
                {Math.round(p.opportunity)}
                <small>opportunity</small>
              </span>
              <span className="facts">
                <span>Popularity <b>{Math.round(p.popularity)}</b></span>
                <span>Difficulty <b>{Math.round(p.difficulty)}</b></span>
                <span>Top 10 earn <b>{money(p.nicheRevenue)}</b>/mo</span>
              </span>
              <span className="why">{pickReason(p)}</span>
            </a>
          ))}
        </div>
      )}

      <h2 className="section serif">All keywords</h2>
      <form className="filters" method="get" action="/keywords">
        <select name="country" defaultValue={country} aria-label="Country">
          {(countries.length ? countries : ['us']).map((c) => (
            <option key={c} value={c}>{COUNTRY_NAMES[c] ?? c.toUpperCase()}</option>
          ))}
        </select>
        <select name="tag" defaultValue={tag} aria-label="Tag">
          <option value="all">Any tag</option>
          {(Object.keys(TAG_LABEL) as Tag[]).map((t) => (
            <option key={t} value={t}>{TAG_LABEL[t]}</option>
          ))}
        </select>
        <select name="minpop" defaultValue={String(f.minPopularity)} aria-label="Minimum popularity">
          <option value="0">Any popularity</option>
          <option value="20">Popularity ≥ 20</option>
          <option value="40">Popularity ≥ 40</option>
          <option value="60">Popularity ≥ 60</option>
        </select>
        <select name="maxdiff" defaultValue={String(f.maxDifficulty)} aria-label="Maximum difficulty">
          <option value="100">Any difficulty</option>
          <option value="60">Difficulty ≤ 60</option>
          <option value="40">Difficulty ≤ 40</option>
          <option value="25">Difficulty ≤ 25</option>
        </select>
        <select name="sort" defaultValue={sort} aria-label="Sort by">
          <option value="opportunity">Sort: opportunity</option>
          <option value="popularity">Sort: popularity</option>
          <option value="difficulty">Sort: easiest first</option>
          <option value="niche">Sort: top-10 revenue</option>
          <option value="potential">Sort: top-5 typical revenue</option>
        </select>
        <input type="search" name="q" defaultValue={f.q} placeholder="Filter keywords" aria-label="Filter keywords" />
        <button className="btn" type="submit">Apply</button>
      </form>

      {rows.length === 0 ? (
        <p className="muted">{filtered ? 'No keywords match these filters.' : 'No keywords scored for this country yet.'}</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Keyword</th>
                <th title="0–100, from how early App Store autocomplete suggests it">Popularity</th>
                <th title="0–100, strength of the apps in the top 10 search results">Difficulty</th>
                <th className="num" title="0–100: demand × openness, weighted by niche revenue">Opportunity</th>
                <th className="num" title="Estimated monthly revenue of the top 10 results combined">Top 10 revenue</th>
                <th className="num" title="Median estimated monthly revenue of the top 5 results ($0 when below the charts)">Top 5 typical</th>
                <th className="num">Results</th>
                <th>#1 result</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 500).map((r) => (
                <tr key={r.id}>
                  <td>
                    <a href={`/keywords/${r.id}`}><strong style={{ fontWeight: 500 }}>{r.term}</strong></a>
                    {r.parent && <span className="range">from “{r.parent}”</span>}
                  </td>
                  <td>
                    <Meter value={r.popularity} label="Popularity" />
                    {r.popularityChange !== null && Math.abs(r.popularityChange) >= 1 && (
                      <span className={`range delta ${r.popularityChange > 0 ? 'up' : 'down'}`}>
                        {r.popularityChange > 0 ? '↑' : '↓'} {Math.abs(Math.round(r.popularityChange))} in 7d
                      </span>
                    )}
                  </td>
                  <td><Meter value={r.difficulty} label="Difficulty" invert /></td>
                  <td className="num"><strong>{Math.round(r.opportunity)}</strong></td>
                  <td className="num">{money(r.nicheRevenue)}</td>
                  <td className="num">{r.top5MedianRevenue > 0 ? money(r.top5MedianRevenue) : <span className="faint">below charts</span>}</td>
                  <td className="num">{r.results}</td>
                  <td>
                    {r.topApp ? (
                      <a href={`/app/${r.topApp.id}`} className="appcell" style={{ minWidth: 180 }}>
                        <AppIcon src={r.topApp.iconUrl} name={r.topApp.name} size={24} />
                        <span className="small">{r.topApp.name}</span>
                      </a>
                    ) : '—'}
                  </td>
                  <td>
                    <span className="tags">
                      {r.tags.map((t) => <span key={t} className={`tag ${t}`}>{TAG_LABEL[t]}</span>)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 500 && <p className="muted small">Showing the first 500 of {count(rows.length)}. Narrow the filters to see the rest.</p>}

      <div className="card" style={{ marginTop: 32 }}>
        <h3>Research a keyword</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Scores it now (a few seconds each) and tracks it daily. Up to 5, separated by commas.
        </p>
        <form action={addKeywordAction} className="form-grid">
          <label className="wide">Keywords
            <input className="input" name="term" required placeholder="habit tracker, sleep sounds" />
          </label>
          <label>Country
            <select className="select" name="country" defaultValue={country}>
              {Object.keys(STOREFRONT).map((c) => (
                <option key={c} value={c}>{COUNTRY_NAMES[c] ?? c.toUpperCase()}</option>
              ))}
            </select>
          </label>
          <label className="check" style={{ alignSelf: 'end', paddingBottom: 10 }}>
            <input type="checkbox" name="expand" defaultChecked /> Also track its suggestions
          </label>
          <div><button className="btn" type="submit">Research</button></div>
        </form>
      </div>

      <details className="card mist" style={{ marginTop: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 500 }}>How the scores work</summary>
        <div className="prose small" style={{ fontSize: 14, marginTop: 12 }}>
          <p>
            <strong>Popularity</strong> comes from App Store autocomplete. A keyword suggested after one or two typed letters, near the top of
            the list, is searched far more than one that only appears when typed in full. Apple does not publish search volumes, so
            this ranks keywords against each other; it is not a search count.
          </p>
          <p>
            <strong>Difficulty</strong> looks at the top 10 search results: how many ratings they have (55%), how many put every word of the
            keyword in their title (25%), and how many earn enough to chart (20%). Apps launched in the last year in the top 10 lower it,
            because new apps are getting in.
          </p>
          <p>
            <strong>Opportunity</strong> is the geometric mean of popularity and (100 − difficulty), scaled from 0.6 to 1.0 by how much the top
            10 earn, so a winnable keyword in a niche that makes money ranks first. Search positions come from Apple’s public Search API,
            which closely tracks, but is not identical to, results in the App Store app.
          </p>
        </div>
      </details>
    </>
  );
}
