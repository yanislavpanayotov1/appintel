# Appintel — App Store revenue estimates

Daily scraper and web app that estimates revenue and downloads for iOS apps from public App Store chart positions.

## Quick start

```bash
npm install
npm run scrape        # collect today's charts, app details, and build estimates (~35 min for 7 countries; ~6,300 apps per country, paced to Apple’s lookup limit)
npm run build && npm start   # or: npm run dev
```

Open http://localhost:3000.

## What gets collected

| Data | Source | Cost |
|---|---|---|
| Top grossing / free / paid iPhone charts, overall + 24 categories, 100 positions each, per country | Apple iTunes RSS feeds | Free |
| Price, category, rating count, average rating | Apple iTunes Lookup API (100 ids per call, paced at 1 call per 3.2 s) | Free |
| Same details, alternative source | Apify actor `automation-lab/apple-app-store-scraper` (optional) | Pay per result |

Roughly 75 chart feeds and 3,000–4,000 unique apps per country per day.

## The revenue model

1. **Category → overall rank.** Apps that appear in both a category chart and the overall chart on the same day are used to fit `ln(overall) = α + β·ln(category)` for each chart, country and day. Category ranks then map onto the overall scale (beyond #100).
2. **Rank → revenue.** `revenue/day = A · rank^(−b)` on the top-grossing chart. The same form on the free and paid charts gives downloads.
3. **Fallbacks.** Paid apps without a grossing rank use paid downloads × US price. Free apps without one use downloads × an assumed revenue per download for the category.
4. **Confidence.** Each estimate is labelled high (overall grossing), medium (category grossing or paid) or low (downloads × revenue per download), with a likely range.
5. **Calibration.** Known revenue figures fit `A` and `b` (see below). Until then the model runs on **priors** in `src/lib/config.ts`. Those priors are assumptions, not measured values, and the UI labels these estimates "Uncalibrated".

Details and every assumption are listed on `/methodology`.

## Calibrating (makes the dollar amounts meaningful)

Rank order comes from Apple. Dollar amounts come from calibration. Add real revenue for apps that held a top-grossing rank (overall or category) on at least half the days of the period:

```bash
# A published figure (gross = what customers paid; use --type proceeds for after-Apple amounts)
npm run calibrate:add -- --app 1621328561 --country ww --from 2026-10-01 --to 2026-10-31 \
  --revenue 125000 --type gross --source "https://link-to-source"

# Verified revenue from a public TrustMRR profile (last-30-days daily table)
npm run calibrate:trustmrr -- <slug>

# Fit and recompute every estimate
npm run calibrate:fit
```

The same actions are available on `/calibration` in the web app.

- 1–2 points fit only the scale (`b` stays at the prior).
- 3 or more points fit both `A` and `b`.
- A country with 3 or more of its own points also gets its own scale.

## Scheduling

Apple updates the charts continuously, so run the scrape once a day:

```cron
15 6 * * *  cd /path/to/appintel && npm run scrape >> data/scrape.log 2>&1
```

Re-running on the same day overwrites that day's data, so retries are safe.

## Scraper options

```bash
npm run scrape -- --countries us,gb            # subset of countries
npm run scrape -- --genres 6014,6007           # subset of categories (quick test)
npm run scrape -- --skip-details               # charts only
npm run scrape -- --date 2026-11-06            # label the run with a specific date
APIFY_TOKEN=... npm run scrape -- --details-source apify
```

Environment variables (see `.env.example`): `APPINTEL_DB`, `APPINTEL_COUNTRIES`, `APIFY_TOKEN`, `APIFY_ACTOR`, `APPINTEL_DETAILS_SOURCE`.

## Other commands

```bash
npm run estimate      # recompute all estimates (after editing priors in src/lib/config.ts)
npm test              # model, calibration and parser tests
npm run typecheck
```

## Layout

```
scraper/run.ts                 daily orchestrator (charts → details → estimates)
scraper/sources/               Apple charts, Apple Lookup, Apify, HTTP retry/rate limit
src/lib/config.ts              countries, categories, all model priors
src/lib/model/rankmap.ts       category → overall rank mapping
src/lib/model/estimate.ts      per-day estimates (revenue, downloads, confidence, range)
src/lib/model/calibrate.ts     curve fitting against known revenue
src/lib/trustmrr.ts            TrustMRR profile import
src/lib/queries.ts             aggregations for the UI (run-rate, growth, categories)
src/app/                       Next.js pages: /, /app/[id], /categories, /calibration, /methodology, /api/export
data/appintel.db               SQLite database (created on first run)
```

## Limits

- Only apps that appear in a chart get an estimate. Totals cover charting apps only, not the whole store.
- iPhone charts only. iPad and Google Play are not included.
- Apple's overall top-free chart can leave some categories out entirely (for example, no Games appeared in the US top-free 100 on 2026-11-06). Download mapping for those categories borrows the category's top-grossing mapping from the same day.
- The Apify details source maps output fields defensively but has not been run end-to-end here (it needs a paid token). Test it with a small run first.
- Design adapted from Refero's "Steep" style (serif display, warm peach accent, 24 px cards, pill controls). Chart colours were validated for contrast in light and dark mode.
