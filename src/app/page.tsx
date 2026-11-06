import { getLeaderboard, getMeta, getSparklines } from '../lib/queries';
import { parseFilter, filterHref } from '../lib/filters';
import { COUNTRY_NAMES, GENRES } from '../lib/config';
import { money, count } from '../lib/format';
import { AppIcon, CalibratedBadge, ConfidenceBadge, Delta, Sparkline, StatTile } from '../components/ui';

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function RevenuePage({ searchParams }: { searchParams: SP }) {
  const meta = getMeta();
  if (!meta.latestDate) return <EmptyState />;
  const f = parseFilter(await searchParams, meta.countries);
  const { rows, total, totals } = getLeaderboard(f);
  const sparks = getSparklines(rows.map((r) => r.appId), f.country, 30);
  const pages = Math.max(1, Math.ceil(total / f.pageSize));
  const scope = f.country === 'all' ? `${meta.countries.length} tracked ${meta.countries.length === 1 ? 'country' : 'countries'}` : COUNTRY_NAMES[f.country] ?? f.country.toUpperCase();
  const top = totals.top;

  return (
    <>
      <section className="hero">
        <h1 className="serif">What apps are earning</h1>
        <p>
          Estimated App Store revenue for {count(meta.appsTracked)} iOS apps across {scope}, modelled daily from
          top-grossing, free and paid chart positions.
        </p>
      </section>

      <div className="grid k4">
        <StatTile
          label={`Estimated revenue, monthly run-rate`}
          value={money(totals.monthly)}
          sub={`${count(totals.apps)} apps in this view`}
        />
        <StatTile
          label="Top earner"
          value={top ? money(top.monthlyRevenue) : '—'}
          sub={top ? <a href={`/app/${top.appId}`}>{top.name}</a> : '—'}
        />
        <StatTile label="History" value={`${meta.daysOfData} day${meta.daysOfData === 1 ? '' : 's'}`} sub={meta.daysOfData < 14 ? 'Growth needs 14 days of data' : `Since ${meta.firstDate}`} />
        <StatTile
          label="Model"
          value={<CalibratedBadge calibrated={meta.calibrated} />}
          sub={meta.calibrated ? `${meta.calibrationPoints} known revenue figures` : <a href="/calibration">Add known revenue figures →</a>}
        />
      </div>

      <h2 className="section serif">Revenue leaderboard</h2>
      <form className="filters" method="get" action="/">
        <select name="country" defaultValue={f.country} aria-label="Country">
          <option value="all">All tracked countries</option>
          {meta.countries.map((c) => (
            <option key={c} value={c}>{COUNTRY_NAMES[c] ?? c.toUpperCase()}</option>
          ))}
        </select>
        <select name="genre" defaultValue={f.genre ?? ''} aria-label="Category">
          <option value="">All categories</option>
          {Object.entries(GENRES)
            .sort((a, b) => a[1].localeCompare(b[1]))
            .map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
        </select>
        <select name="model" defaultValue={f.model} aria-label="Business model">
          <option value="all">Free & paid</option>
          <option value="free">Free (in-app purchases)</option>
          <option value="paid">Paid upfront</option>
        </select>
        <select name="confidence" defaultValue={f.confidence} aria-label="Confidence">
          <option value="all">Any confidence</option>
          <option value="high">High confidence</option>
          <option value="medium">Medium confidence</option>
          <option value="low">Low confidence</option>
        </select>
        <select name="sort" defaultValue={f.sort} aria-label="Sort by">
          <option value="revenue">Sort: revenue</option>
          <option value="growth">Sort: 7-day growth</option>
          <option value="downloads">Sort: downloads</option>
          <option value="rpd">Sort: revenue per download</option>
        </select>
        <select name="window" defaultValue={String(f.window)} aria-label="Averaging window">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        <input type="search" name="q" defaultValue={f.q} placeholder="Search apps or developers" aria-label="Search" />
        <button className="btn" type="submit">Apply</button>
        <a className="btn ghost" href={filterHref('/api/export', f, { page: 1 })}>Export CSV</a>
      </form>

      {rows.length === 0 ? (
        <div className="card mist empty">
          <h2 className="serif">No apps match</h2>
          <p className="muted">Try a different country, category or confidence level.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th aria-label="Position"></th>
                <th>App</th>
                <th>Category</th>
                <th className="num" title="Average estimated daily revenue in the window × 30">Revenue / month</th>
                <th className="num">Per day</th>
                <th className="num" title="Last 7 days vs previous 7 days">7d growth</th>
                <th className="num">Downloads / day</th>
                <th className="num" title="Revenue per download">RPD</th>
                <th>Last 30 days</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.appId}>
                  <td className="rank tnum">{(f.page - 1) * f.pageSize + i + 1}</td>
                  <td>
                    <a href={`/app/${r.appId}`} className="appcell">
                      <AppIcon src={r.iconUrl} name={r.name} />
                      <span>
                        <span className="nm">{r.name}</span>
                        <br />
                        <span className="dev">
                          {r.developer ?? ''}
                          {r.price && r.price > 0 ? ` · $${r.price.toFixed(2)}` : ''}
                        </span>
                      </span>
                    </a>
                  </td>
                  <td className="muted small">{r.genreName ?? '—'}</td>
                  <td className="num">
                    <strong>{money(r.monthlyRevenue)}</strong>
                    <span className="range">{money(r.monthlyLow)}–{money(r.monthlyHigh)}</span>
                  </td>
                  <td className="num">{money(r.dailyRevenue)}</td>
                  <td className="num"><Delta value={r.growth} /></td>
                  <td className="num">{count(r.dailyDownloads)}</td>
                  <td className="num">{r.rpd !== null ? money(r.rpd, { precise: true }) : '—'}</td>
                  <td>
                    <Sparkline values={sparks.get(r.appId) ?? []} label={`Daily revenue trend for ${r.name}`} />
                  </td>
                  <td>
                    <ConfidenceBadge level={r.confidence} method={r.method} />
                    {r.daysObserved < Math.min(r.windowDays, meta.daysOfData) ? (
                      <span className="range" title="Days with a chart position in the window">{r.daysObserved}/{Math.min(r.windowDays, meta.daysOfData)} days</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pager">
        <span>
          {total ? `${(f.page - 1) * f.pageSize + 1}–${Math.min(f.page * f.pageSize, total)} of ${count(total)} apps` : ''}
          {f.country === 'all' && total ? ` · revenue summed across ${meta.countries.length} ${meta.countries.length === 1 ? 'country' : 'countries'}` : ''}
        </span>
        <span style={{ display: 'flex', gap: 8 }}>
          {f.page > 1 && <a className="btn ghost" href={filterHref('/', f, { page: f.page - 1 })}>← Previous</a>}
          {f.page < pages && <a className="btn ghost" href={filterHref('/', f, { page: f.page + 1 })}>Next →</a>}
        </span>
      </div>
      <p className="muted small" style={{ marginTop: 24 }}>
        Ranges show the likely band ({meta.calibrated ? 'from calibration residuals' : 'default ×/÷ factors for uncalibrated estimates'}). Growth compares the
        last 7 days to the 7 before, and needs at least 3 days in each.
      </p>
    </>
  );
}

function EmptyState() {
  return (
    <section className="hero">
      <h1 className="serif">No data yet</h1>
      <p>Run the scraper to collect today’s App Store charts and build the first estimates:</p>
      <pre className="card mist" style={{ marginTop: 20, overflowX: 'auto' }}><code>npm run scrape</code></pre>
    </section>
  );
}
