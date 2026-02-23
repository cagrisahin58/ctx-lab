import { useState, useEffect } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "./ui/button";

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
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={() => setZoom((z) => Math.max(0.8, +(z - 0.1).toFixed(1)))}
        disabled={zoom <= 0.8}
        title="Zoom out"
      >
        <ZoomOut size={14} />
      </Button>
      <span
        className="font-mono tabular-nums select-none text-center text-[10px]"
        style={{ color: "hsl(var(--muted-foreground))", width: 28 }}
      >
        {Math.round(zoom * 100)}%
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(1)))}
        disabled={zoom >= 1.5}
        title="Zoom in"
      >
        <ZoomIn size={14} />
      </Button>
    </div>
  );
}
