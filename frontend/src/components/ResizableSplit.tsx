import { useCallback, useEffect, useRef, useState } from "react";

interface ResizableSplitProps {
  direction: "horizontal" | "vertical";
  ratio: number;
  onRatioChange: (ratio: number) => void;
  first: React.ReactNode;
  second: React.ReactNode;
  minRatio?: number;
  maxRatio?: number;
}

export function usePersistentRatio(key: string, defaultRatio: number) {
  const [ratio, setRatio] = useState(() => {
    const saved = localStorage.getItem(key);
    const parsed = saved !== null ? parseFloat(saved) : NaN;
    return Number.isFinite(parsed) ? Math.min(0.85, Math.max(0.15, parsed)) : defaultRatio;
  });
  const set = useCallback(
    (v: number) => {
      setRatio(v);
      localStorage.setItem(key, String(v));
    },
    [key]
  );
  return [ratio, set] as const;
}

export function ResizableSplit({
  direction,
  ratio,
  onRatioChange,
  first,
  second,
  minRatio = 0.15,
  maxRatio = 0.85,
}: ResizableSplitProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const isVertical = direction === "vertical";

  const clamp = useCallback(
    (v: number) => Math.min(maxRatio, Math.max(minRatio, v)),
    [minRatio, maxRatio]
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pos = isVertical ? e.clientY - rect.top : e.clientX - rect.left;
      const size = isVertical ? rect.height : rect.width;
      onRatioChange(clamp(pos / size));
    };
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, isVertical, clamp, onRatioChange]);

  const onHandleKeyDown = (e: React.KeyboardEvent) => {
    const step = 0.02;
    if (
      (isVertical && e.key === "ArrowUp") ||
      (!isVertical && e.key === "ArrowLeft")
    ) {
      e.preventDefault();
      onRatioChange(clamp(ratio - step));
    }
    if (
      (isVertical && e.key === "ArrowDown") ||
      (!isVertical && e.key === "ArrowRight")
    ) {
      e.preventDefault();
      onRatioChange(clamp(ratio + step));
    }
  };

  return (
    <div
      ref={containerRef}
      className={`split split-${direction} ${dragging ? "split-dragging" : ""}`}
    >
      <div className="split-pane" style={{ flex: `${ratio} 1 0%` }}>
        {first}
      </div>
      <div
        className="split-handle"
        role="separator"
        aria-orientation={isVertical ? "horizontal" : "vertical"}
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault();
          setDragging(true);
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onKeyDown={onHandleKeyDown}
      />
      <div className="split-pane" style={{ flex: `${1 - ratio} 1 0%` }}>
        {second}
      </div>
    </div>
  );
}
