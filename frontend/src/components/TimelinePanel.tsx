import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Badge } from "@astryxdesign/core";
import type { Block, Track } from "../api/client";
import { useStore } from "../store/useStore";

const SUBROW_HEIGHT = 64;
const LANE_PADDING = 8;
const MAX_SUBROWS = 3;
const RULER_HEIGHT = 28;

function fmtTick(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface DragState {
  blockId: number;
  mode: "move" | "resize";
  startClientX: number;
  origStart: number;
  origDuration: number;
  origTrackId: number;
  currentStart: number;
  currentDuration: number;
  currentTrackId: number;
}

interface RowAssignment {
  row: number;
  rows: number;
}

function layoutRows(blocks: Block[]): Map<number, RowAssignment> {
  const sorted = [...blocks].sort((a, b) => a.start_seconds - b.start_seconds || a.id - b.id);
  const rowEnds: number[] = [];
  const assignment = new Map<number, RowAssignment>();
  for (const b of sorted) {
    let placed = -1;
    for (let r = 0; r < rowEnds.length; r++) {
      if (b.start_seconds >= rowEnds[r] - 0.001) {
        placed = r;
        break;
      }
    }
    if (placed === -1) {
      placed = rowEnds.length;
      rowEnds.push(0);
    }
    rowEnds[placed] = b.start_seconds + Math.max(b.duration_seconds, 1);
    assignment.set(b.id, { row: placed, rows: 0 });
  }
  const totalRows = Math.max(1, rowEnds.length);
  for (const value of assignment.values()) {
    value.rows = Math.min(totalRows, MAX_SUBROWS);
    value.row = Math.min(value.row, MAX_SUBROWS - 1);
  }
  return assignment;
}

function laneHeight(rows: number) {
  return LANE_PADDING * 2 + rows * SUBROW_HEIGHT - 4;
}

function TrackLabel({
  track,
  height,
  onPointerDown,
  dragOffset,
  onLiveHeight,
}: {
  track: Track;
  height: number;
  onPointerDown?: (e: React.PointerEvent, track: Track) => void;
  dragOffset?: number | null;
  onLiveHeight?: (trackId: number, height: number | null) => void;
}) {
  const { renameTrack, deleteTrack, toggleScriptTrack, createBlock, blocks, setTrackHeight } =
    useStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(track.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const heightDragRef = useRef<{ startY: number; startH: number; last: number } | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  const commitRename = () => {
    setEditing(false);
    if (name.trim() && name.trim() !== track.name) renameTrack(track.id, name.trim());
    else setName(track.name);
  };

  const onHeightGripDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    heightDragRef.current = { startY: e.clientY, startH: height, last: height };
    const onMove = (ev: PointerEvent) => {
      const g = heightDragRef.current;
      if (!g) return;
      const h = Math.min(320, Math.max(24, Math.round(g.startH + (ev.clientY - g.startY))));
      g.last = h;
      onLiveHeight?.(track.id, h);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const g = heightDragRef.current;
      heightDragRef.current = null;
      if (g) {
        onLiveHeight?.(track.id, null);
        setTrackHeight(track.id, g.last);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className={`track-label ${dragOffset !== null && dragOffset !== undefined ? "track-label-dragging" : ""}`}
      style={{
        height,
        transform: dragOffset ? `translateY(${dragOffset}px)` : undefined,
      }}
      onPointerDown={(e) => onPointerDown?.(e, track)}
    >
      <span className="track-label-edge" style={{ background: track.color }} />
      {editing ? (
        <input
          className="track-rename-input"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setName(track.name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <span
          className="track-label-name"
          title={`${track.name} — double-click to rename`}
          onDoubleClick={() => setEditing(true)}
        >
          {track.name}
          {track.is_script_track && (
            <span style={{ fontSize: "10px", color: "var(--color-accent)", marginLeft: "4px", fontWeight: 600 }}>[Script]</span>
          )}
        </span>
      )}
      <div className="track-menu-wrap" onClick={(e) => e.stopPropagation()}>
        <button
          className="track-menu-trigger"
          title="Track options"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          ⋮
        </button>
        {menuOpen && (
          <div className="track-menu-popover">
            <button
              className={`track-menu-item ${track.is_script_track ? "track-menu-item-active" : ""}`}
              onClick={() => {
                toggleScriptTrack(track.id);
                setMenuOpen(false);
              }}
            >
              <span style={{ fontWeight: 600 }}>Aa</span>
              <span>{track.is_script_track ? "Disable Script Track" : "Make Script Track"}</span>
            </button>
            <button
              className="track-menu-item"
              onClick={() => {
                const existing = Object.values(blocks).filter((b) => b.track === track.id);
                const end = Math.max(0, ...existing.map((b) => b.start_seconds + b.duration_seconds));
                createBlock(track.id, Math.round(end + 2));
                setMenuOpen(false);
              }}
            >
              <span>+</span>
              <span>Add Block</span>
            </button>
            <button
              className="track-menu-item track-menu-item-danger"
              onClick={() => {
                setMenuOpen(false);
                if (window.confirm(`Delete track "${track.name}" and all its blocks?`)) {
                  deleteTrack(track.id);
                }
              }}
            >
              <span>🗑️</span>
              <span>Delete Track</span>
            </button>
          </div>
        )}
      </div>
      <span
        className="track-height-grip"
        title="Drag to resize lane height · double-click to reset"
        onPointerDown={onHeightGripDown}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setTrackHeight(track.id, null);
        }}
      />
    </div>
  );
}


export function TimelinePanel() {
  const {
    tracks,
    blocks,
    pxPerSecond,
    setPxPerSecond,
    activeBlockId,
    setActiveBlock,
    setHoverBlock,
    revealSignal,
    moveBlock,
    resizeBlock,
    createTrack,
    deleteBlock,
    reorderTracks,
    trackHeights,
    presence,
    agentFlash,
  } = useStore();

  const [liveHeights, setLiveHeights] = useState<Record<number, number | null>>({});
  const onLiveHeight = useCallback((trackId: number, height: number | null) => {
    setLiveHeights((prev) => ({ ...prev, [trackId]: height }));
  }, []);

  const [labelWidth, setLabelWidth] = useState<number>(() => {
    try {
      return Number(localStorage.getItem("scriptedit_timeline_label_width") ?? 200);
    } catch {
      return 200;
    }
  });
  const [labelDragging, setLabelDragging] = useState(false);

  useEffect(() => {
    if (!labelDragging) return;
    const onMove = (e: PointerEvent) => {
      const el = scrollRef.current?.closest(".timeline-panel") as HTMLElement;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pos = e.clientX - rect.left;
      const next = Math.min(480, Math.max(120, Math.round(pos)));
      setLabelWidth(next);
      localStorage.setItem("scriptedit_timeline_label_width", String(next));
    };
    const onUp = () => setLabelDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [labelDragging]);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [trackDrag, setTrackDrag] = useState<{
    id: number;
    startY: number;
    deltaY: number;
    insertIdx: number;
  } | null>(null);
  const [addingTrack, setAddingTrack] = useState(false);
  const [newTrackName, setNewTrackName] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  const trackDragRef = useRef(trackDrag);
  trackDragRef.current = trackDrag;

  const syncLabelScroll = () => {
    if (labelsRef.current && scrollRef.current) {
      labelsRef.current.scrollTop = scrollRef.current.scrollTop;
    }
  };

  const orderedTracks = useMemo(
    () => [...tracks].sort((a, b) => a.order - b.order || a.id - b.id),
    [tracks]
  );

  const blocksByTrack = useMemo(() => {
    const map = new Map<number, Block[]>();
    for (const b of Object.values(blocks)) {
      const list = map.get(b.track) ?? [];
      list.push(b);
      map.set(b.track, list);
    }
    return map;
  }, [blocks]);

  const rowLayout = useMemo(() => {
    const map = new Map<number, Map<number, RowAssignment>>();
    for (const t of orderedTracks) {
      map.set(t.id, layoutRows(blocksByTrack.get(t.id) ?? []));
    }
    return map;
  }, [orderedTracks, blocksByTrack]);

  const laneTops = useMemo(() => {
    const tops = new Map<number, { top: number; height: number }>();
    let acc = 0;
    for (const t of orderedTracks) {
      const layout = rowLayout.get(t.id);
      const rows = layout && layout.size > 0 ? [...layout.values()][0].rows : 1;
      const custom = liveHeights[t.id] ?? trackHeights[t.id];
      const h = custom != null ? Math.max(24, custom) : laneHeight(rows);
      tops.set(t.id, { top: acc, height: h });
      acc += h;
    }
    return { tops, total: acc };
  }, [orderedTracks, rowLayout, liveHeights, trackHeights]);


  const trackAtY = useCallback(
    (y: number): Track | null => {
      for (const t of orderedTracks) {
        const info = laneTops.tops.get(t.id);
        if (info && y >= info.top && y < info.top + info.height) return t;
      }
      return orderedTracks[orderedTracks.length - 1] ?? null;
    },
    [orderedTracks, laneTops]
  );

  const onBlockPointerDown = useCallback(
    (e: React.PointerEvent, block: Block, mode: "move" | "resize") => {
      if (e.button !== 0) return;
      e.stopPropagation();
      setActiveBlock(block.id);
      const state: DragState = {
        blockId: block.id,
        mode,
        startClientX: e.clientX,
        origStart: block.start_seconds,
        origDuration: block.duration_seconds,
        origTrackId: block.track,
        currentStart: block.start_seconds,
        currentDuration: block.duration_seconds,
        currentTrackId: block.track,
      };
      setDrag(state);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [setActiveBlock]
  );

  useEffect(() => {
    if (!drag) return;
    const laneEl = scrollRef.current;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startClientX) / pxPerSecond;
      const next: DragState = { ...d };
      if (d.mode === "move") {
        next.currentStart = Math.max(0, d.origStart + dx);
        if (laneEl) {
          const rect = laneEl.getBoundingClientRect();
          const y = e.clientY - rect.top + laneEl.scrollTop - RULER_HEIGHT;
          const target = trackAtY(y);
          if (target) next.currentTrackId = target.id;
        }
      } else {
        next.currentDuration = Math.max(1, d.origDuration + dx);
      }
      setDrag(next);
    };
    const onUp = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (d.mode === "move") {
        if (d.currentStart !== d.origStart || d.currentTrackId !== d.origTrackId) {
          moveBlock(
            d.blockId,
            d.currentStart,
            d.currentTrackId !== d.origTrackId ? d.currentTrackId : undefined
          );
        }
      } else if (d.currentDuration !== d.origDuration) {
        resizeBlock(d.blockId, d.currentDuration);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, pxPerSecond, trackAtY, moveBlock, resizeBlock]);

  const onLabelPointerDown = useCallback(
    (e: React.PointerEvent, track: Track) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button, input")) return;
      e.preventDefault();
      const idx = orderedTracks.findIndex((t) => t.id === track.id);
      setTrackDrag({ id: track.id, startY: e.clientY, deltaY: 0, insertIdx: idx });
    },
    [orderedTracks]
  );

  useEffect(() => {
    if (!trackDrag) return;
    const onMove = (e: PointerEvent) => {
      const d = trackDragRef.current;
      const labelsEl = labelsRef.current;
      if (!d || !labelsEl) return;
      const rect = labelsEl.getBoundingClientRect();
      const y = e.clientY - rect.top + labelsEl.scrollTop - RULER_HEIGHT;
      let insertIdx = orderedTracks.length;
      for (let i = 0; i < orderedTracks.length; i++) {
        const info = laneTops.tops.get(orderedTracks[i].id);
        if (info && y < info.top + info.height / 2) {
          insertIdx = i;
          break;
        }
      }
      setTrackDrag({ ...d, deltaY: e.clientY - d.startY, insertIdx });
    };
    const onUp = () => {
      const d = trackDragRef.current;
      setTrackDrag(null);
      if (!d) return;
      const ids = orderedTracks.map((t) => t.id);
      const from = ids.indexOf(d.id);
      if (from === -1) return;
      ids.splice(from, 1);
      let to = d.insertIdx;
      if (to > from) to -= 1;
      ids.splice(to, 0, d.id);
      if (ids.some((id, i) => id !== orderedTracks[i].id)) {
        reorderTracks(ids);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [trackDrag, orderedTracks, laneTops, reorderTracks]);

  const dropIndicatorY = useMemo(() => {
    if (!trackDrag) return null;
    if (trackDrag.insertIdx >= orderedTracks.length) {
      return RULER_HEIGHT + laneTops.total;
    }
    const info = laneTops.tops.get(orderedTracks[trackDrag.insertIdx].id);
    return info ? RULER_HEIGHT + info.top : null;
  }, [trackDrag, orderedTracks, laneTops]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        setPxPerSecond(useStore.getState().pxPerSecond * factor);
      } else {
        el.scrollLeft += e.deltaY + e.deltaX;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setPxPerSecond]);

  useEffect(() => {
    if (!revealSignal || !scrollRef.current) return;
    const b = blocks[revealSignal.blockId];
    if (!b) return;
    setActiveBlock(b.id);
    const target = b.start_seconds * pxPerSecond;
    const view = scrollRef.current;
    view.scrollTo({
      left: Math.max(0, target - view.clientWidth / 2),
      behavior: "smooth",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealSignal]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && activeBlockId !== null) {
        const target = e.target as HTMLElement;
        if (target.closest(".ProseMirror") || target.closest("input, textarea, select")) return;
        e.preventDefault();
        deleteBlock(activeBlockId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeBlockId, deleteBlock]);

  const maxEnd = Math.max(
    300,
    ...Object.values(blocks).map((b) => b.start_seconds + b.duration_seconds + 60)
  );
  const tickInterval = pxPerSecond >= 8 ? 10 : pxPerSecond >= 4 ? 30 : 60;
  const ticks: number[] = [];
  for (let t = 0; t <= maxEnd; t += tickInterval) ticks.push(t);

  const contentWidth = maxEnd * pxPerSecond;

  const blockLabel = (b: Block) => {
    if (b.title) return b.title;
    if (b.content_markdown) return b.content_markdown.slice(0, 60);
    if (b.source_url) return b.source_url.replace(/^https?:\/\//, "").slice(0, 50);
    return `Block ${b.id}`;
  };

  return (
    <div className="timeline-panel">
      <div className="timeline-toolbar">
        <Badge label="Timeline" variant="neutral" />
        <div className="zoom-control">
          <span className="zoom-label">Zoom</span>
          <input
            type="range"
            min={1}
            max={20}
            step={0.5}
            value={pxPerSecond}
            onChange={(e) => setPxPerSecond(parseFloat(e.target.value))}
          />
        </div>
      </div>
      <div className="timeline-body">
        <div
          className="timeline-labels"
          style={{ width: labelWidth }}
          ref={labelsRef}
          onScroll={() => {
            if (labelsRef.current && scrollRef.current) {
              scrollRef.current.scrollTop = labelsRef.current.scrollTop;
            }
          }}
        >
          <div style={{ height: RULER_HEIGHT }} className="ruler-corner" />
          {orderedTracks.map((t) => (
            <TrackLabel
              key={t.id}
              track={t}
              height={laneTops.tops.get(t.id)?.height ?? laneHeight(1)}
              onPointerDown={onLabelPointerDown}
              dragOffset={trackDrag?.id === t.id ? trackDrag.deltaY : null}
              onLiveHeight={onLiveHeight}
            />
          ))}
          {dropIndicatorY !== null && (
            <div className="track-drop-indicator" style={{ top: dropIndicatorY }} />
          )}
          <div className="track-add-row">
            {addingTrack ? (
              <input
                className="track-rename-input"
                placeholder="Track name…"
                value={newTrackName}
                autoFocus
                onChange={(e) => setNewTrackName(e.target.value)}
                onBlur={() => {
                  if (newTrackName.trim()) createTrack(newTrackName.trim());
                  setNewTrackName("");
                  setAddingTrack(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTrackName.trim()) {
                    createTrack(newTrackName.trim());
                    setNewTrackName("");
                    setAddingTrack(false);
                  }
                  if (e.key === "Escape") {
                    setNewTrackName("");
                    setAddingTrack(false);
                  }
                }}
              />
            ) : (
              <Button
                label="+ Add Track"
                variant="secondary"
                size="sm"
                onClick={() => setAddingTrack(true)}
              />
            )}
          </div>
        </div>

        <div
          className={`timeline-col-handle ${labelDragging ? "split-handle-active" : ""}`}
          onPointerDown={(e) => {
            e.preventDefault();
            setLabelDragging(true);
          }}
          title="Drag to resize track column proportion"
        />

        <div className="timeline-scroll" ref={scrollRef} onScroll={syncLabelScroll}>
          <div style={{ width: contentWidth, position: "relative" }}>
            <div className="ruler" style={{ height: RULER_HEIGHT }}>
              {ticks.map((t) => (
                <span key={t} className="ruler-tick" style={{ left: t * pxPerSecond }}>
                  {fmtTick(t)}
                </span>
              ))}
            </div>
            <div className="gridlines" style={{ top: RULER_HEIGHT, height: laneTops.total }}>
              {ticks.map((t) => (
                <span
                  key={t}
                  className={t % 60 === 0 ? "gridline gridline-major" : "gridline"}
                  style={{ left: t * pxPerSecond }}
                />
              ))}
            </div>
            {dropIndicatorY !== null && (
              <div className="lane-drop-indicator" style={{ top: dropIndicatorY }} />
            )}
            {orderedTracks.map((t) => {
              const laneInfo = laneTops.tops.get(t.id)!;
              const layout = rowLayout.get(t.id) ?? new Map<number, RowAssignment>();
              const isCompact = laneInfo.height < 48;
              const itemHeight = isCompact ? Math.max(16, laneInfo.height - 6) : undefined;
              return (
                <div
                  key={t.id}
                  className="lane"
                  style={{ height: laneInfo.height, top: 0 }}
                >
                  {(blocksByTrack.get(t.id) ?? []).map((b) => {
                    const isDragging = drag?.blockId === b.id;
                    const start = isDragging ? drag.currentStart : b.start_seconds;
                    const duration = isDragging ? drag.currentDuration : b.duration_seconds;
                    const ownTop = laneTops.tops.get(b.track)?.top ?? 0;
                    const ownRow = layout.get(b.id)?.row ?? 0;
                    let top: number;
                    if (isDragging && drag.currentTrackId !== b.track) {
                      const targetTop = laneTops.tops.get(drag.currentTrackId)?.top ?? ownTop;
                      top = targetTop - ownTop + (isCompact ? 3 : LANE_PADDING);
                    } else {
                      top = isCompact ? 3 : LANE_PADDING + ownRow * SUBROW_HEIGHT;
                    }
                    const holder = presence[b.id];
                    const flash = agentFlash[b.id] && Date.now() - agentFlash[b.id] < 1200;
                    return (
                      <div
                        key={b.id}
                        className={[
                          "block",
                          activeBlockId === b.id ? "block-active" : "",
                          isDragging ? "block-dragging" : "",
                          flash ? "block-flash" : "",
                        ].join(" ")}
                        style={{
                          left: start * pxPerSecond,
                          width: Math.max(24, duration * pxPerSecond),
                          top,
                          height: itemHeight ? `${itemHeight}px` : undefined,
                          background: t.color,
                        }}

                        onPointerDown={(e) => onBlockPointerDown(e, b, "move")}
                        onMouseEnter={() => setHoverBlock(b.id)}
                        onMouseLeave={() => setHoverBlock(null)}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveBlock(b.id);
                        }}
                        title={blockLabel(b)}
                      >
                        {b.anchor_block && <span className="anchor-notch" title="Anchored" />}
                        <span className="block-text">{blockLabel(b)}</span>
                        {holder && holder.holder !== "user" && (
                          <span className="block-agent-dot" title={`${holder.holder} is editing`} />
                        )}
                        <span
                          className="block-resize-handle"
                          onPointerDown={(e) => onBlockPointerDown(e, b, "resize")}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

