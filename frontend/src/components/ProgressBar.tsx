export function ProgressBar({ percent }: { percent: number }) {
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex-1 rounded-full overflow-hidden"
        style={{ height: 5, background: "hsl(var(--border))" }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${clamped}%`, background: "hsl(var(--primary))" }}
        />
      </div>
      <span className="font-mono tabular-nums" style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
        {Math.round(clamped)}%
      </span>
    </div>
  );
}
