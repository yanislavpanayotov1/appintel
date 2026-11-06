import {
  US_PRIOR,
  COUNTRY_SCALE_PRIOR,
  RPD_PRIOR_BY_GENRE,
  DEFAULT_RPD,
  GENRES,
  APPLE_COMMISSION,
  DEFAULT_BAND,
  UNMAPPED_CATEGORY_TOP_RANK,
  RATINGS_PER_DOWNLOAD,
  COUNTRY_NAMES,
} from '../../lib/config';
import { money } from '../../lib/format';

export default function MethodologyPage() {
  return (
    <>
      <section className="hero">
        <h1 className="serif">How the estimates work</h1>
        <p>Every number on this site is a model output. This page lists the data sources, each step and every assumption.</p>
      </section>
      <div className="prose">
        <h2>1 · Data collected daily</h2>
        <ul>
          <li>
            <strong>Charts</strong> — Apple’s public iTunes RSS feeds (<code>itunes.apple.com/&lt;country&gt;/rss/…</code>): top grossing, top
            free and top paid iPhone apps, overall and for {Object.keys(GENRES).length} categories, 100 positions each, per country.
          </li>
          <li>
            <strong>App details</strong> — Apple’s iTunes Lookup API (batches of 100, paced under its ~20 calls/minute limit): price,
            category, rating count and average rating. Optional: the Apify actor <code>automation-lab/apple-app-store-scraper</code>{' '}
            (paid per result) via <code>--details-source apify</code>.
          </li>
          <li>Every run stores a snapshot, so history accumulates from the first day. Growth needs 14 days.</li>
        </ul>

        <h2>2 · Category rank → overall-equivalent rank</h2>
        <p>
          Overall charts stop at #100. Category charts reach deeper into the market. For each chart, country and day, apps that appear in
          both a category chart and the overall chart give pairs (category rank, overall rank). We fit{' '}
          <code>ln(overall) = α + β·ln(category)</code> when there are ≥ 3 pairs, anchor α on the observed pairs with the day’s median β
          when there are 1–2. When a category has no app in an overall free or paid chart (Apple leaves some categories out of these, e.g. Games), we borrow that category’s top-grossing mapping for the same day; only if that is also missing do we assume category #1 ≈ overall #{UNMAPPED_CATEGORY_TOP_RANK}.
          A mapped rank is never better than the category rank or the last overall position + 1.
        </p>

        <h2>3 · Rank → revenue and downloads</h2>
        <p>
          Revenue per day follows a power law: <code>revenue = A · rank<sup>−b</sup></code>. Downloads use the same form on the free or paid
          chart, matching the app’s price. Methods, in order of preference:
        </p>
        <ol>
          <li><strong>Overall top-grossing rank</strong> — high confidence.</li>
          <li><strong>Category top-grossing rank</strong>, mapped as above — medium confidence.</li>
          <li><strong>Paid apps without a grossing rank</strong>: paid downloads × US price — medium confidence.</li>
          <li><strong>Free apps without a grossing rank</strong>: downloads × assumed revenue per download for the category — low confidence.</li>
        </ol>
        <p>
          Country totals are summed for “all tracked countries”. Monthly figures are the window’s average daily estimate × 30. Revenue is
          gross (what customers pay); after Apple’s commission ({Math.round(APPLE_COMMISSION * 100)}% standard, 15% for small businesses and
          subscriptions after year one) the developer keeps less.
        </p>

        <h2>4 · Calibration</h2>
        <p>
          Known revenue for charting apps (published figures, TrustMRR verified revenue) is compared to the model over the same days. We
          search <code>b</code> on a grid (0.4–1.6) and solve a global scale in closed form, minimising squared error in log space. With
          fewer than 3 points only the scale is fitted. Countries with ≥ 3 of their own points get an additional scale. The residual spread
          sets the likely range shown next to every estimate.
        </p>

        <h2>5 · Assumptions in use (priors)</h2>
        <p>
          These are starting values, not measured figures, and are replaced by calibration where data allows. Edit them in{' '}
          <code>src/lib/config.ts</code>, then run <code>npm run estimate</code>.
        </p>
        <table className="data" style={{ marginBottom: 16 }}>
          <thead><tr><th>Curve (US)</th><th className="num">A (rank #1 per day)</th><th className="num">b</th></tr></thead>
          <tbody>
            <tr><td>Top grossing → revenue</td><td className="num">{money(US_PRIOR.grossing.A)}</td><td className="num">{US_PRIOR.grossing.b}</td></tr>
            <tr><td>Top free → downloads</td><td className="num">{US_PRIOR.free.A.toLocaleString('en-US')}</td><td className="num">{US_PRIOR.free.b}</td></tr>
            <tr><td>Top paid → downloads</td><td className="num">{US_PRIOR.paid.A.toLocaleString('en-US')}</td><td className="num">{US_PRIOR.paid.b}</td></tr>
          </tbody>
        </table>
        <p>
          Market size vs US:{' '}
          {Object.entries(COUNTRY_SCALE_PRIOR).map(([c, v], i) => (
            <span key={c}>{i ? ', ' : ''}{COUNTRY_NAMES[c] ?? c} ×{v}</span>
          ))}
          .
        </p>
        <p>
          Revenue per download (free apps without a grossing rank): default ${DEFAULT_RPD.toFixed(2)};{' '}
          {Object.entries(RPD_PRIOR_BY_GENRE).map(([g, v], i) => (
            <span key={g}>{i ? ', ' : ''}{GENRES[Number(g)]} ${v.toFixed(2)}</span>
          ))}
          .
        </p>
        <p>
          Likely range without calibration: ×/÷{DEFAULT_BAND.high} (high), ×/÷{DEFAULT_BAND.medium} (medium), ×/÷{DEFAULT_BAND.low} (low).
          Rating-velocity cross-check assumes {(RATINGS_PER_DOWNLOAD * 100).toFixed(1)}% of downloaders leave a rating.
        </p>

        <h2>6 · Keyword research</h2>
        <p>
          Search positions come from Apple’s public iTunes Search API (top 50 kept per keyword per day). It closely tracks, but is not
          identical to, results in the App Store app.
        </p>
        <ul>
          <li>
            <strong>Popularity</strong> (0–100): how few letters are typed before App Store autocomplete suggests the keyword, and how high it
            sits in that list. When Apple only suggests longer phrases starting with it, those count at 90%. Apple publishes no search
            volumes, so this ranks keywords against each other.
          </li>
          <li>
            <strong>Difficulty</strong> (0–100): the top 10 results’ rating volume (55%), the share with every keyword word in their title
            (25%) and the share earning enough to chart (20%), minus up to 10 points when apps launched in the last year are ranking.
          </li>
          <li>
            <strong>Opportunity</strong> (0–100): √(popularity × (100 − difficulty)), scaled from 0.6 to 1.0 by the top 10’s combined
            estimated revenue (≥ $10M a month gives 1.0). Best picks are the highest-opportunity keywords with popularity ≥ 20, one per
            close variant.
          </li>
        </ul>

        <h2>7 · Known limits</h2>
        <ul>
          <li>Apps below every chart (most apps) get no estimate. Totals cover charting apps only.</li>
          <li>The overall top-free chart can exclude some categories; their download mapping borrows the grossing mapping, which assumes a category is about as strong in downloads as in revenue.</li>
          <li>iPhone charts only; iPad and Google Play are not included.</li>
          <li>Keyword popularity is relative; it cannot be converted to a number of searches without Apple Search Ads data.</li>
          <li>Worldwide calibration figures are compared with the sum of tracked countries only, which biases the scale upward slightly.</li>
        </ul>
      </div>
    </>
  );
}
