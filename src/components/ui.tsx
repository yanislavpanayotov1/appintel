import type { Confidence, RevenueMethod } from '../lib/config';
import { METHOD_LABEL } from '../lib/config';
import { pct } from '../lib/format';

/** Confidence carried by icon shape + text, not colour alone. */
export function ConfidenceBadge({ level, method }: { level: Confidence; method?: RevenueMethod | null }) {
  const title = method ? `${level} confidence — ${METHOD_LABEL[method]}` : `${level} confidence`;
  const filled = level === 'high' ? 3 : level === 'medium' ? 2 : 1;
  return (
    <span className="badge" title={title}>
      <svg width="12" height="10" viewBox="0 0 12 10" aria-hidden>
        {[0, 1, 2].map((i) => (
          <rect
            key={i}
            x={i * 4}
            y={6 - i * 3}
            width="3"
            height={4 + i * 3}
            rx="1"
            fill={i < filled ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={i < filled ? 0 : 1}
            opacity={i < filled ? 1 : 0.45}
          />
        ))}
      </svg>
      {level[0].toUpperCase() + level.slice(1)}
    </span>
  );
}

export function CalibratedBadge({ calibrated }: { calibrated: boolean }) {
  return calibrated ? (
    <span className="badge cal" title="Curve fitted to known revenue figures">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path d="M2 5.2 4.1 7.3 8 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Calibrated
    </span>
  ) : (
    <span className="badge" title="Using prior assumptions — add calibration points to fit the model">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 1.6" />
      </svg>
      Uncalibrated
    </span>
  );
}

export function Delta({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <span className="faint">—</span>;
  const dir = value > 0.005 ? 'up' : value < -0.005 ? 'down' : '';
  const arrow = dir === 'up' ? '↑' : dir === 'down' ? '↓' : '→';
  return (
    <span className={`delta ${dir}`}>
      <span aria-hidden>{arrow}</span> {pct(value)}
    </span>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export function AppIcon({ src, name, size = 40 }: { src: string | null; name: string; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? (
    <img src={src} alt="" width={size} height={size} loading="lazy" className="icon" style={{ width: size, height: size }} />
  ) : (
    <span className="icon" aria-hidden style={{ width: size, height: size, display: 'inline-block' }} title={name} />
  );
}

/** Static sparkline (server-rendered): 2px line, end dot with surface ring; gaps where no estimate. */
export function Sparkline({ values, width = 96, height = 28, label }: { values: (number | null)[]; width?: number; height?: number; label: string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v !== null) as { v: number; i: number }[];
  if (pts.length < 2) return <span className="faint tiny">{pts.length === 1 ? '1 day' : '—'}</span>;
  const max = Math.max(...pts.map((p) => p.v));
  const min = Math.min(...pts.map((p) => p.v));
  const pad = 4;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - pad * 2);
  const y = (v: number) => (max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * (height - pad * 2));
  // Break the line where days are missing.
  const segs: string[] = [];
  let cur = '';
  values.forEach((v, i) => {
    if (v === null) {
      if (cur) segs.push(cur);
      cur = '';
    } else cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (cur) segs.push(cur);
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {segs.map((d, k) => (
        <path key={k} d={d} fill="none" stroke="var(--chart)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      ))}
      <circle cx={x(last.i)} cy={y(last.v)} r="3" fill="var(--chart)" stroke="var(--paper)" strokeWidth="2" />
    </svg>
  );
}

/** Horizontal bars with the value at the tip (single series, so no legend). */
export function BarList({ rows, format }: { rows: { label: React.ReactNode; value: number; href?: string; note?: string }[]; format: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <div className="bars" role="list">
      {rows.map((r, i) => (
        <div className="barrow" role="listitem" key={i} title={r.note}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {r.href ? <a href={r.href}>{r.label}</a> : r.label}
          </span>
          <span className="bartrack">
            <span className="barfill" style={{ display: 'block', width: `${max ? Math.max(0.5, (r.value / max) * 100) : 0}%` }} />
          </span>
          <span className="val">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}
