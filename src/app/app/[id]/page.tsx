import { notFound } from 'next/navigation';
import { getApp, getMeta, getRankSeries } from '../../../lib/queries';
import { parseWindow } from '../../../lib/filters';
import { COUNTRY_NAMES, GENRES, METHOD_LABEL, OVERALL, APPLE_COMMISSION, RATINGS_PER_DOWNLOAD } from '../../../lib/config';
import { money, count, rankLabel, shortDate } from '../../../lib/format';
import { AppIcon, BarList, CalibratedBadge, ConfidenceBadge, Delta, StatTile } from '../../../components/ui';
import { LineChart } from '../../../components/LineChart';

type Params = Promise<{ id: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

const CHART_NAME: Record<string, string> = { grossing: 'Top grossing', free: 'Top free', paid: 'Top paid' };

export default async function AppPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const window = parseWindow(String(sp.window ?? '30'));
  const appId = Number(id);
  if (!Number.isInteger(appId)) notFound();
  const d = getApp(appId, window);
  if (!d) notFound();
  const meta = getMeta();
  const { app, summary } = d;
  const topCountry = d.byCountry[0]?.country ?? summary?.topCountry ?? 'us';
  const rankSeries = getRankSeries(appId, topCountry);
  const latest = meta.latestDate;
  const latestRanks = d.ranks.filter((r) => r.date === latest);
  const mapFor = (country: string, chart: string, genreId: number) =>
    d.latestMaps.find((m) => m.country === country && m.chart === chart && m.genreId === genreId);
  const usTop = d.byCountry.find((c) => c.country === topCountry);
  const genreName = (app.genre_id !== null && GENRES[app.genre_id]) || app.genre_name;

  return (
    <>
      <section className="app-head">
        <AppIcon src={app.icon_url} name={app.name} size={88} />
        <div>
          <h1 className="serif">{app.name}</h1>
          <div className="muted">
            {app.developer ?? 'Unknown developer'}
            {genreName ? ` · ${genreName}` : ''}
            {app.price && app.price > 0 ? ` · $${app.price.toFixed(2)}` : ' · Free'}
            {app.url ? (
              <>
                {' · '}
                <a href={app.url} target="_blank" rel="noreferrer">App Store ↗</a>
              </>
            ) : null}
          </div>
        </div>
      </section>

      {!summary ? (
        <div className="card mist">
          <h3>No revenue estimate in the last {window} days</h3>
          <p className="muted small" style={{ margin: 0 }}>
            The app has not held a chart position that supports an estimate in this window. Try a longer window.
          </p>
        </div>
      ) : (
        <>
          <div className="grid k3">
            <div className="card" style={{ gridColumn: 'span 2' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="muted small">Estimated revenue, monthly run-rate (gross, all tracked countries)</span>
                <span className="seg" role="group" aria-label="Averaging window">
                  {[7, 30, 90].map((w) => (
                    <a key={w} href={`/app/${appId}${w === 30 ? '' : `?window=${w}`}`} aria-current={w === window ? 'true' : undefined}>
                      {w}d
                    </a>
                  ))}
                </span>
              </div>
              <div className="hero-figure" style={{ margin: '14px 0 6px' }}>{money(summary.monthlyRevenue)}</div>
              <div className="muted">
                Likely {money(summary.monthlyLow)} – {money(summary.monthlyHigh)} · {money(summary.dailyRevenue)}/day ·
                after Apple’s {Math.round(APPLE_COMMISSION * 100)}% ≈ {money(summary.monthlyRevenue * (1 - APPLE_COMMISSION))}/month
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <ConfidenceBadge level={summary.confidence} method={summary.method} />
                <CalibratedBadge calibrated={summary.calibrated} />
                <span className="badge">7d growth&nbsp;<Delta value={summary.growth} /></span>
                <span className="badge">{summary.daysObserved} of {Math.min(window, meta.daysOfData)} days observed</span>
              </div>
            </div>
            <div className="card peach">
              <h3>How this is estimated</h3>
              <p className="small" style={{ margin: '6px 0 0' }}>
                {summary.method ? METHOD_LABEL[summary.method] : '—'} in {COUNTRY_NAMES[topCountry] ?? topCountry}.{' '}
                {summary.method === 'grossing_overall' &&
                  `Today’s top-grossing position ${rankLabel(usTop?.grossingEqRank)} is converted to daily revenue with a power-law curve fitted per country.`}
                {summary.method === 'grossing_category' &&
                  `The app ranks only in its category’s top-grossing chart. That position is mapped to an overall-equivalent rank (${rankLabel(usTop?.grossingEqRank)}) using apps that appear in both charts the same day, then converted with the revenue curve.`}
                {summary.method === 'paid_downloads' && 'Paid-chart position → daily downloads, multiplied by the US price.'}
                {summary.method === 'downloads_rpd' &&
                  'No top-grossing rank. Free-chart position → daily downloads, multiplied by an assumed revenue per download for the category. Treat as a rough guide.'}
              </p>
              <p className="small" style={{ margin: '10px 0 0' }}>
                <a href="/methodology" style={{ textDecoration: 'underline' }}>Methodology →</a>
              </p>
            </div>
          </div>

          <h2 className="section serif">Daily revenue</h2>
          <div className="card">
            <LineChart
              label={`Estimated daily revenue for ${app.name}, summed across tracked countries`}
              format="money"
              points={d.series.map((p) => ({
                date: p.date,
                value: p.revenue,
                low: p.low,
                high: p.high,
                extra: p.downloads != null ? [{ k: 'Downloads', v: count(p.downloads) }] : undefined,
              }))}
            />
          </div>

          <div className="grid k2" style={{ marginTop: 16 }}>
            <div className="card">
              <h3>Revenue by country</h3>
              <p className="muted small" style={{ marginTop: 0 }}>Monthly run-rate, last {window} days</p>
              <BarList
                rows={d.byCountry.map((c) => ({
                  label: COUNTRY_NAMES[c.country] ?? c.country.toUpperCase(),
                  value: c.daily * 30,
                  note: `${METHOD_LABEL[c.method]} · ${c.confidence} confidence · ${c.days} days`,
                }))}
                format={(v) => money(v)}
              />
            </div>
            <div className="card">
              <h3>Top-grossing position in {COUNTRY_NAMES[topCountry] ?? topCountry}</h3>
              <p className="muted small" style={{ marginTop: 0 }}>Overall-equivalent rank (≈ marks ranks mapped from a category chart)</p>
              <LineChart
                label={`Top-grossing overall-equivalent rank for ${app.name} in ${topCountry}`}
                format="rank"
                invert
                height={200}
                points={rankSeries.map((r) => ({
                  date: r.date,
                  value: r.eq,
                  extra: r.method ? [{ k: 'Method', v: METHOD_LABEL[r.method as keyof typeof METHOD_LABEL] ?? r.method }] : undefined,
                }))}
              />
            </div>
          </div>

          <div className="grid k4" style={{ marginTop: 16 }}>
            <StatTile label="Downloads / day" value={count(summary.dailyDownloads)} sub={summary.dailyDownloads === null ? 'Not in a free/paid chart' : 'Chart-based estimate'} />
            <StatTile label="Revenue per download" value={summary.rpd !== null ? money(summary.rpd, { precise: true }) : '—'} sub="Revenue ÷ downloads" />
            <StatTile
              label="New ratings / day"
              value={d.ratingVelocity?.perDay != null ? count(d.ratingVelocity.perDay) : '—'}
              sub={d.ratingVelocity?.days ? `Over ${Math.round(d.ratingVelocity.days)} days` : 'Needs 2+ daily snapshots'}
            />
            <StatTile
              label="Downloads implied by ratings"
              value={d.ratingVelocity?.impliedDownloads != null ? count(d.ratingVelocity.impliedDownloads) : '—'}
              sub={`Cross-check at ${(RATINGS_PER_DOWNLOAD * 100).toFixed(1)}% rating rate`}
            />
          </div>
        </>
      )}

      <h2 className="section serif">Chart positions{latest ? ` on ${shortDate(latest)}` : ''}</h2>
      {latestRanks.length === 0 ? (
        <p className="muted">Not in any tracked chart on the latest day.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Country</th>
                <th>Chart</th>
                <th>Scope</th>
                <th className="num">Position</th>
                <th>Category → overall mapping</th>
              </tr>
            </thead>
            <tbody>
              {latestRanks
                .sort((a, b) => a.country.localeCompare(b.country) || a.chart.localeCompare(b.chart) || a.genreId - b.genreId)
                .map((r) => {
                  const m = r.genreId === OVERALL ? null : mapFor(r.country, r.chart, r.genreId);
                  return (
                    <tr key={`${r.country}-${r.chart}-${r.genreId}`}>
                      <td>{COUNTRY_NAMES[r.country] ?? r.country.toUpperCase()}</td>
                      <td>{CHART_NAME[r.chart]}</td>
                      <td className="muted">{r.genreId === OVERALL ? 'All apps' : GENRES[r.genreId] ?? r.genreId}</td>
                      <td className="num">#{r.rank}</td>
                      <td className="muted small">
                        {r.genreId === OVERALL
                          ? '—'
                          : m
                            ? m.method === 'fitted'
                              ? `Fitted from ${m.n} apps in both charts`
                              : m.method === 'anchored'
                                ? `Anchored on ${m.n} app${m.n === 1 ? '' : 's'} in both charts`
                                : m.method === 'borrowed'
                                  ? 'No overlap — borrowed from the category’s top-grossing mapping'
                                  : 'No overlap with overall chart — assumed'
                            : '—'}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section serif">Known revenue</h2>
      {d.calibration.length === 0 ? (
        <div className="card mist callout">
          <div>
            <h3>No ground-truth figures for this app</h3>
            <p className="muted small" style={{ margin: 0 }}>
              If the developer has published revenue (a founder post, TrustMRR, an earnings report), add it — every figure improves
              the model for all apps.{' '}
              <a href={`/calibration?app=${appId}`} style={{ textDecoration: 'underline' }}>Add a figure →</a>
            </p>
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Period</th>
                <th>Country</th>
                <th className="num">Reported (gross)</th>
                <th className="num">Model</th>
                <th>Source</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {d.calibration.map((p) => (
                <tr key={p.id}>
                  <td className="tnum">{p.periodStart} → {p.periodEnd}</td>
                  <td>{p.country === 'ww' ? 'All tracked' : p.country.toUpperCase()}</td>
                  <td className="num">{money(p.observedGross)}</td>
                  <td className="num">{p.predicted !== null ? money(p.predicted) : '—'}</td>
                  <td className="small">{p.source}</td>
                  <td className="small muted">{p.usable ? 'Used in fit' : p.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
