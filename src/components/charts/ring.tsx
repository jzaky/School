/** Progress ring for a single percentage, with the number in the middle. */
export function Ring({ value, size = 96, tone = "var(--success)", label }: { value: number; size?: number; tone?: string; label?: string }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={`${label ?? ""} ${pct}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--muted)" strokeWidth={8} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={tone} strokeWidth={8} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      </svg>
      <span className="absolute text-lg font-semibold tabular-nums">{pct}%</span>
    </div>
  );
}
