export function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex-1 rounded-full overflow-hidden"
        style={{ height: 5, background: "var(--border-default)" }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${clamped}%`, background: "var(--accent)" }}
        />
      </div>
      <span className="font-mono tabular-nums" style={{ fontSize: 11, color: "var(--text-muted)" }}>
        {Math.round(clamped)}%
      </span>
    </div>
  );
}
