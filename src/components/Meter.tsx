/** 0–100 score as a thin bar plus its number. The number carries the value; the bar is a glance aid. */
export function Meter({ value, label, invert = false }: { value: number; label: string; invert?: boolean }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <span className="meter" title={`${label}: ${Math.round(v)} / 100`}>
      <span className="meter-num tnum">{Math.round(v)}</span>
      <span className="meter-track" aria-hidden>
        <span className={`meter-fill${invert ? ' inv' : ''}`} style={{ width: `${v}%` }} />
      </span>
    </span>
  );
}
