import type { Metadata } from 'next';
import { Inter, Source_Serif_4 } from 'next/font/google';
import './globals.css';
import { Nav } from '../components/Nav';
import { getMeta } from '../lib/queries';
import { shortDate } from '../lib/format';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const serif = Source_Serif_4({ subsets: ['latin'], weight: ['400'], style: ['normal', 'italic'], variable: '--font-serif', display: 'swap' });

export const metadata: Metadata = {
  title: 'Appintel — App Store revenue estimates',
  description: 'Daily revenue and download estimates for iOS apps, modelled from App Store chart ranks.',
};

export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const meta = getMeta();
  const stale =
    meta.latestDate && Date.now() - Date.parse(meta.latestDate + 'T00:00:00Z') > 2 * 86_400_000;
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <header className="topbar">
          <div className="wrap">
            <a href="/" className="brand serif">Appintel</a>
            <Nav />
            <span className="fresh" title={meta.lastRun ? `Last scrape: ${meta.lastRun.status}` : 'No scrape yet'}>
              <span className={`dot ${!meta.latestDate ? 'off' : stale || meta.lastRun?.status !== 'ok' ? 'warn' : ''}`} aria-hidden />
              {meta.latestDate ? `Data through ${shortDate(meta.latestDate)}` : 'No data yet'}
            </span>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="footer">
          <div className="wrap">
            Revenue and downloads are model estimates derived from public App Store chart positions — not reported figures.
            {' '}
            {meta.calibrated
              ? `Calibrated against ${meta.calibrationPoints} known revenue figure${meta.calibrationPoints === 1 ? '' : 's'}.`
              : 'Currently uncalibrated: add known revenue figures on the Calibration page.'}
          </div>
        </footer>
      </body>
    </html>
  );
}
