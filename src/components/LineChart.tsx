'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

export interface LinePoint {
  date: string;
  value: number | null;
  low?: number | null;
  high?: number | null;
  /** extra tooltip rows */
  extra?: { k: string; v: string }[];
}

interface Props {
  points: LinePoint[];
  label: string;
  format: 'money' | 'count' | 'rank';
  height?: number;
  /** rank charts: lower is better, log scale, inverted */
  invert?: boolean;
  bandLabel?: string;
}

function fmt(kind: Props['format'], v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (kind === 'rank') return v <= 100 ? `#${Math.round(v)}` : `≈#${Math.round(v)}`;
  const a = Math.abs(v);
  const pre = kind === 'money' ? '$' : '';
  if (a >= 1e6) return `${pre}${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${pre}${(v / 1e3).toFixed(0)}K`;
  if (a >= 1e3) return `${pre}${(v / 1e3).toFixed(1)}K`;
  return `${pre}${Math.round(v).toLocaleString('en-US')}`;
}

function niceTicks(min: number, max: number, n = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

function shortDate(d: string) {
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function LineChart({ points, label, format, height = 240, invert = false, bandLabel = 'Likely range' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setWidth(Math.max(280, e[0].contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const m = { top: 12, right: 16, bottom: 26, left: 56 };
  const iw = width - m.left - m.right;
  const ih = height - m.top - m.bottom;
  const n = points.length;
  const hasBand = points.some((p) => p.low != null && p.high != null);

  const { yScale, ticks } = useMemo(() => {
    const vals: number[] = [];
    for (const p of points) {
      if (p.value != null) vals.push(p.value);
      if (p.low != null) vals.push(p.low);
      if (p.high != null) vals.push(p.high);
    }
    if (!vals.length) return { yScale: () => ih / 2, ticks: [] as number[] };
    if (invert) {
      // Ranks: log scale, #1 at top.
      // Keep at least a ×4 span so a flat or single-day series still gets readable ticks.
      let lo = Math.max(1, Math.min(...vals));
      let hi = Math.max(...vals);
      if (hi / lo < 4) {
        const mid = Math.sqrt(lo * hi);
        lo = Math.max(1, mid / 2);
        hi = Math.max(lo * 4, mid * 2);
      }
      const l0 = Math.log10(lo) - 0.05;
      const l1 = Math.log10(hi) + 0.05;
      const candidates = [1, 2, 3, 5, 10, 20, 30, 50, 100, 200, 300, 500, 1000, 2000, 5000];
      const t = candidates.filter((c) => c >= Math.pow(10, l0) && c <= Math.pow(10, l1));
      return { yScale: (v: number) => ((Math.log10(Math.max(1, v)) - l0) / (l1 - l0)) * ih, ticks: t };
    }
    const max = Math.max(...vals) * 1.08;
    const t = niceTicks(0, max);
    const top = Math.max(max, t[t.length - 1] ?? max);
    return { yScale: (v: number) => ih - (v / top) * ih, ticks: t };
  }, [points, ih, invert]);

  const x = (i: number) => (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);

  const segments: string[] = [];
  let cur = '';
  points.forEach((p, i) => {
    if (p.value == null) {
      if (cur) segments.push(cur);
      cur = '';
    } else cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${yScale(p.value).toFixed(1)}`;
  });
  if (cur) segments.push(cur);

  // Band polygons per contiguous run.
  const bands: string[] = [];
  if (hasBand) {
    let run: number[] = [];
    const flush = () => {
      if (run.length) {
        const top = run.map((i) => `${x(i).toFixed(1)},${yScale(points[i].high!).toFixed(1)}`);
        const bot = [...run].reverse().map((i) => `${x(i).toFixed(1)},${yScale(points[i].low!).toFixed(1)}`);
        if (run.length === 1) {
          const i = run[0];
          const w = Math.min(8, iw / 2);
          bands.push(`M${x(i) - w},${yScale(points[i].high!)}H${x(i) + w}V${yScale(points[i].low!)}H${x(i) - w}Z`);
        } else bands.push(`M${top.join('L')}L${bot.join('L')}Z`);
      }
      run = [];
    };
    points.forEach((p, i) => (p.low != null && p.high != null ? run.push(i) : flush()));
    flush();
  }

  const lastIdx = [...points.keys()].reverse().find((i) => points[i].value != null);
  const xTickIdx = n <= 1 ? [0] : Array.from(new Set([0, Math.round((n - 1) / 3), Math.round((2 * (n - 1)) / 3), n - 1]));

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * iw;
    const i = n <= 1 ? 0 : Math.round((px / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  const hp = hover !== null ? points[hover] : null;
  const tipLeft = hover !== null ? m.left + x(hover) : 0;

  if (!points.some((p) => p.value != null)) {
    return <div className="muted small" style={{ padding: '24px 0' }}>No data in this period yet.</div>;
  }

  return (
    <div className="chart" ref={ref}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={label}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') setHover((h) => Math.min(n - 1, (h ?? -1) + 1));
          if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? n) - 1));
          if (e.key === 'Escape') setHover(null);
        }}
        onBlur={() => setHover(null)}
      >
        <g transform={`translate(${m.left},${m.top})`}>
          <g className="axis">
            {ticks.map((t) => (
              <g key={t} transform={`translate(0,${yScale(t)})`}>
                <line className="gridline" x1={0} x2={iw} />
                <text x={-10} dy="0.32em" textAnchor="end">{fmt(format, t)}</text>
              </g>
            ))}
            {xTickIdx.map((i) => (
              <text key={i} x={x(i)} y={ih + 18} textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}>
                {shortDate(points[i].date)}
              </text>
            ))}
          </g>
          {bands.map((d, k) => (
            <path key={k} d={d} fill="var(--chart-band)" />
          ))}
          {segments.map((d, k) => (
            <path key={k} d={d} fill="none" stroke="var(--chart)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {/* isolated single days get a dot so they are visible */}
          {points.map((p, i) =>
            p.value != null && (i === 0 || points[i - 1].value == null) && (i === n - 1 || points[i + 1].value == null) ? (
              <circle key={i} cx={x(i)} cy={yScale(p.value)} r={4} fill="var(--chart)" stroke="var(--paper)" strokeWidth={2} />
            ) : null,
          )}
          {lastIdx !== undefined && points[lastIdx].value != null && (
            <circle cx={x(lastIdx)} cy={yScale(points[lastIdx].value!)} r={4} fill="var(--chart)" stroke="var(--paper)" strokeWidth={2} />
          )}
          {hp && (
            <g pointerEvents="none">
              <line x1={x(hover!)} x2={x(hover!)} y1={0} y2={ih} stroke="var(--ash)" strokeWidth={1} />
              {hp.value != null && <circle cx={x(hover!)} cy={yScale(hp.value)} r={5} fill="var(--chart)" stroke="var(--paper)" strokeWidth={2} />}
            </g>
          )}
          <rect width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </g>
      </svg>
      {hp && (
        <div
          className="tooltip"
          style={{ left: Math.min(Math.max(tipLeft - 70, 0), width - 170), top: 0 }}
          role="status"
        >
          <div className="k">{shortDate(hp.date)}</div>
          <div className="v">{fmt(format, hp.value)}</div>
          {hasBand && hp.low != null && (
            <div className="k">{bandLabel}: {fmt(format, hp.low)} – {fmt(format, hp.high)}</div>
          )}
          {hp.extra?.map((e) => (
            <div key={e.k} className="k">
              {e.k}: <span style={{ color: 'var(--ink)' }}>{e.v}</span>
            </div>
          ))}
        </div>
      )}
      {hasBand && (
        <div className="legend" aria-hidden>
          <span><svg width="16" height="4"><line x1="0" y1="2" x2="16" y2="2" stroke="var(--chart)" strokeWidth="2" /></svg>Estimate</span>
          <span><svg width="12" height="10"><rect width="12" height="10" rx="2" fill="var(--chart-band)" /></svg>{bandLabel}</span>
        </div>
      )}
    </div>
  );
}
