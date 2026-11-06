import { getCalibration, getMeta } from '../../lib/queries';
import { getDb } from '../../lib/db';
import { resolveCurve, priorCurve } from '../../lib/model/params';
import { COUNTRY_NAMES, US_PRIOR } from '../../lib/config';
import { money } from '../../lib/format';
import { powerLaw } from '../../lib/model/math';
import { AppIcon, CalibratedBadge, StatTile } from '../../components/ui';
import { addPointAction, deletePointAction, importTrustMrrAction, refitAction } from './actions';

type SP = Promise<Record<string, string | string[] | undefined>>;
const RANKS = [1, 5, 10, 25, 50, 100, 200, 500, 1000];

export default async function CalibrationPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const meta = getMeta();
  const { points, params } = getCalibration();
  const db = getDb();
  const countries = meta.countries.length ? meta.countries : ['us'];
  const curves = countries.map((c) => ({ c, cur: resolveCurve(db, c, 'grossing'), prior: priorCurve(c, 'grossing') }));
  const global = params.find((p) => p.scope === 'global');
  const usable = points.filter((p) => p.usable).length;
  const prefillApp = typeof sp.app === 'string' ? sp.app : '';
  const today = meta.latestDate ?? new Date().toISOString().slice(0, 10);

  return (
    <>
      <section className="hero">
        <h1 className="serif">Calibration</h1>
        <p>
          Chart ranks tell us order, not amounts. Known revenue figures for apps that chart turn ranks into dollars: each point
          refits the top-grossing curve for every app.
        </p>
      </section>

      {typeof sp.msg === 'string' && <div className="notice ok" role="status" style={{ marginBottom: 16 }}>{sp.msg}</div>}
      {typeof sp.err === 'string' && <div className="notice err" role="alert" style={{ marginBottom: 16 }}>{sp.err}</div>}

      <div className="grid k4">
        <StatTile label="Status" value={<CalibratedBadge calibrated={!!global} />} sub={global ? `Fitted ${global.fitted_at.slice(0, 10)}` : 'Using prior assumptions'} />
        <StatTile label="Points" value={`${usable} / ${points.length}`} sub="Usable / stored" />
        <StatTile
          label="US revenue at rank #1"
          value={money(curves.find((x) => x.c === 'us')?.cur.A ?? US_PRIOR.grossing.A)}
          sub={`per day · prior ${money(US_PRIOR.grossing.A)}`}
        />
        <StatTile
          label="Typical error"
          value={global?.log_rmse != null ? `×/÷ ${Math.exp(global.log_rmse).toFixed(2)}` : '—'}
          sub={global?.mape != null ? `Mean abs. error ${(global.mape * 100).toFixed(0)}%` : 'Needs fitted points'}
        />
      </div>

      <h2 className="section serif">Known revenue figures</h2>
      {points.length === 0 ? (
        <div className="card mist">
          <h3>No figures yet</h3>
          <p className="muted small" style={{ margin: 0 }}>
            Add revenue that a developer has published for an app that appears in the top-grossing charts (overall or category). A point
            is used when the app held a top-grossing rank on at least half the days of its period.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>App</th>
                <th>Period</th>
                <th>Scope</th>
                <th className="num">Reported (gross)</th>
                <th className="num">Model</th>
                <th className="num">Ranked days</th>
                <th>Source</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.id}>
                  <td>
                    <a href={`/app/${p.appId}`} className="appcell" style={{ minWidth: 180 }}>
                      <AppIcon src={p.iconUrl} name={p.appName ?? String(p.appId)} size={28} />
                      <span className="small">{p.appName ?? `App ${p.appId}`}</span>
                    </a>
                  </td>
                  <td className="tnum small">{p.periodStart} → {p.periodEnd}</td>
                  <td>{p.country === 'ww' ? 'Worldwide' : p.country.toUpperCase()}</td>
                  <td className="num">
                    {money(p.observedGross)}
                    {p.revenueType === 'proceeds' && <span className="range">from {money(p.revenue)} proceeds</span>}
                  </td>
                  <td className="num">{p.predicted !== null ? money(p.predicted) : '—'}</td>
                  <td className="num">{(p.coverage * 100).toFixed(0)}%</td>
                  <td className="small" style={{ maxWidth: 220, overflowWrap: 'anywhere' }}>
                    {p.source.startsWith('trustmrr:') ? (
                      <a href={`https://trustmrr.com/startup/${p.source.slice(9)}`} target="_blank" rel="noreferrer">TrustMRR ↗</a>
                    ) : /^https?:\/\//.test(p.source) ? (
                      <a href={p.source} target="_blank" rel="noreferrer">{new URL(p.source).hostname} ↗</a>
                    ) : (
                      p.source
                    )}
                  </td>
                  <td className="small">{p.usable ? 'Used' : <span className="muted">{p.reason}</span>}</td>
                  <td>
                    <form action={deletePointAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className="btn ghost" type="submit" style={{ minHeight: 30, padding: '4px 12px', fontSize: 12 }} aria-label={`Delete point ${p.id}`}>
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form action={refitAction} style={{ marginTop: 12 }}>
        <button className="btn ghost" type="submit">Refit model & recompute estimates</button>
      </form>

      <div className="grid k2" style={{ marginTop: 32 }}>
        <div className="card">
          <h3>Add a revenue figure</h3>
          <p className="muted small" style={{ marginTop: 0 }}>Any period. Use “Worldwide” for revenue across all countries.</p>
          <form action={addPointAction} className="form-grid">
            <label className="wide">App Store id or URL
              <input className="input" name="app" required defaultValue={prefillApp} placeholder="1621328561 or https://apps.apple.com/…/id1621328561" />
            </label>
            <label>Scope
              <select className="select" name="country" defaultValue="ww">
                <option value="ww">Worldwide</option>
                {countries.map((c) => (
                  <option key={c} value={c}>{COUNTRY_NAMES[c] ?? c.toUpperCase()}</option>
                ))}
              </select>
            </label>
            <label>Type
              <select className="select" name="type" defaultValue="gross">
                <option value="gross">Gross (customer spend)</option>
                <option value="proceeds">Proceeds (after Apple)</option>
              </select>
            </label>
            <label>From<input className="input" type="date" name="start" required /></label>
            <label>To<input className="input" type="date" name="end" required defaultValue={today} /></label>
            <label className="wide">Revenue (USD)<input className="input" name="revenue" required inputMode="decimal" placeholder="125000" /></label>
            <label className="wide" style={{ gridColumn: '1 / -1' }}>Source<input className="input" name="source" required placeholder="Link to the post, report or dashboard" /></label>
            <div><button className="btn" type="submit">Save & refit</button></div>
          </form>
        </div>
        <div className="card">
          <h3>Import from TrustMRR</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            Pulls payment-provider-verified daily revenue (last 30 days) from a public TrustMRR profile. Most indie apps there earn too
            little to chart; prefer ones with five-figure monthly revenue.
          </p>
          <form action={importTrustMrrAction} className="form-grid">
            <label className="wide" style={{ gridColumn: '1 / -1' }}>TrustMRR slug or URL
              <input className="input" name="slug" required placeholder="https://trustmrr.com/startup/your-app" />
            </label>
            <label className="wide" style={{ gridColumn: '1 / -1' }}>App Store id (only if the profile has no App Store link)
              <input className="input" name="app" placeholder="optional" />
            </label>
            <div><button className="btn" type="submit">Import & refit</button></div>
          </form>
        </div>
      </div>

      <h2 className="section serif">Current revenue curve</h2>
      <p className="muted" style={{ marginTop: -4 }}>Gross revenue per day at each overall-equivalent top-grossing rank.</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Country</th>
              <th className="num">b</th>
              {RANKS.map((r) => <th key={r} className="num">#{r}</th>)}
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {curves.map(({ c, cur }) => (
              <tr key={c}>
                <td>{COUNTRY_NAMES[c] ?? c.toUpperCase()}</td>
                <td className="num">{cur.b.toFixed(2)}</td>
                {RANKS.map((r) => <td key={r} className="num">{money(powerLaw(cur.A, cur.b, r))}</td>)}
                <td className="small muted">{cur.calibrated ? (params.some((p) => p.scope === c) ? 'Fitted + country scale' : 'Fitted (global)') : 'Prior'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
