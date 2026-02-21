import { useState, useEffect } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";

export function ZoomControl() {
  const [zoom, setZoom] = useState(() => {
    const saved = localStorage.getItem("ctx-lab-zoom");
    return saved ? parseFloat(saved) : 1;
  });

  useEffect(() => {
    document.documentElement.style.setProperty("--ctx-lab-zoom", String(zoom));
    localStorage.setItem("ctx-lab-zoom", String(zoom));
  }, [zoom]);

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setZoom((z) => Math.max(0.8, +(z - 0.1).toFixed(1)))}
        disabled={zoom <= 0.8}
        className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        title="Zoom out"
      >
        <ZoomOut size={16} className="text-gray-600 dark:text-gray-400" />
      </button>
      <span className="text-xs font-mono w-8 text-center text-gray-600 dark:text-gray-400 select-none">
        {Math.round(zoom * 100)}%
      </span>
      <button
        onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(1)))}
        disabled={zoom >= 1.5}
        className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        title="Zoom in"
      >
        <ZoomIn size={16} className="text-gray-600 dark:text-gray-400" />
      </button>
    </div>
  );
}
