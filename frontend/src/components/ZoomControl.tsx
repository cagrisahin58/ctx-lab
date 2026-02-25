import { useState, useEffect } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";

export function ZoomControl() {
  const [zoom, setZoom] = useState(() => {
    const saved = localStorage.getItem("seslog-zoom") || localStorage.getItem("ctx-lab-zoom");
    return saved ? parseFloat(saved) : 1;
  });

  useEffect(() => {
    document.documentElement.style.setProperty("--seslog-zoom", String(zoom));
    localStorage.setItem("seslog-zoom", String(zoom));
    localStorage.removeItem("ctx-lab-zoom");
  }, [zoom]);

  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => setZoom((z) => Math.max(0.8, +(z - 0.1).toFixed(1)))}
        disabled={zoom <= 0.8}
        className="flex items-center justify-center rounded-md transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
        style={{ width: 24, height: 24, color: "var(--text-muted)" }}
        onMouseEnter={(e) => { if (zoom > 0.8) e.currentTarget.style.background = "var(--bg-surface-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        title="Zoom out"
      >
        <ZoomOut size={14} />
      </button>
      <span
        className="font-mono tabular-nums select-none text-center"
        style={{ fontSize: 10, color: "var(--text-muted)", width: 28 }}
      >
        {Math.round(zoom * 100)}%
      </span>
      <button
        onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(1)))}
        disabled={zoom >= 1.5}
        className="flex items-center justify-center rounded-md transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
        style={{ width: 24, height: 24, color: "var(--text-muted)" }}
        onMouseEnter={(e) => { if (zoom < 1.5) e.currentTarget.style.background = "var(--bg-surface-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        title="Zoom in"
      >
        <ZoomIn size={14} />
      </button>
    </div>
  );
}
