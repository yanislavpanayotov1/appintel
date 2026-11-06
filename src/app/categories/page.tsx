import { getCategories, getMeta } from '../../lib/queries';
import { parseWindow } from '../../lib/filters';
import { COUNTRY_NAMES } from '../../lib/config';
import { money, count } from '../../lib/format';
import { AppIcon, BarList, Delta } from '../../components/ui';

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function CategoriesPage({ searchParams }: { searchParams: SP }) {
  const meta = getMeta();
  const sp = await searchParams;
  const country = typeof sp.country === 'string' && meta.countries.includes(sp.country) ? sp.country : 'all';
  const window = parseWindow(String(sp.window ?? '30'));
  const { rows, total } = getCategories(country, window);

  return (
    <>
      <section className="hero">
        <h1 className="serif">Where the money is</h1>
        <p>
          Estimated monthly App Store revenue of charting apps, grouped by primary category —{' '}
          {country === 'all' ? `${meta.countries.length} tracked countries` : COUNTRY_NAMES[country] ?? country}, {money(total)} in total.
        </p>
      </section>

      <form className="filters" method="get" action="/categories">
        <select name="country" defaultValue={country} aria-label="Country">
          <option value="all">All tracked countries</option>
          {meta.countries.map((c) => (
            <option key={c} value={c}>{COUNTRY_NAMES[c] ?? c.toUpperCase()}</option>
          ))}
        </select>
        <select name="window" defaultValue={String(window)} aria-label="Averaging window">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        <button className="btn" type="submit">Apply</button>
      </form>

      {rows.length === 0 ? (
        <div className="card mist empty"><h2 className="serif">No data yet</h2><p className="muted">Run <code className="k">npm run scrape</code>.</p></div>
      ) : (
        <>
          <div className="card">
            <h3>Revenue by category</h3>
            <p className="muted small" style={{ marginTop: 0 }}>Monthly run-rate of apps that chart; long-tail apps below the charts are not included</p>
            <BarList
              rows={rows.map((r) => ({ label: r.name, value: r.monthly, href: `/?genre=${r.genreId}${country !== 'all' ? `&country=${country}` : ''}` }))}
              format={(v) => money(v)}
            />
          </div>

          <h2 className="section serif">Category detail</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">Revenue / month</th>
                  <th className="num">Share</th>
                  <th className="num">7d growth</th>
                  <th className="num">Apps</th>
                  <th className="num">Avg per app</th>
                  <th>Top earner</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.genreId}>
                    <td><a href={`/?genre=${r.genreId}${country !== 'all' ? `&country=${country}` : ''}`}>{r.name}</a></td>
                    <td className="num"><strong>{money(r.monthly)}</strong></td>
                    <td className="num">{(r.share * 100).toFixed(1)}%</td>
                    <td className="num"><Delta value={r.growth} /></td>
                    <td className="num">{count(r.apps)}</td>
                    <td className="num">{money(r.monthly / Math.max(1, r.apps))}</td>
                    <td>
                      {r.topApp ? (
                        <a href={`/app/${r.topApp.id}`} className="appcell" style={{ minWidth: 200 }}>
                          <AppIcon src={r.topApp.iconUrl} name={r.topApp.name} size={28} />
                          <span className="small">{r.topApp.name} <span className="muted">· {money(r.topApp.monthly)}</span></span>
                        </a>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
