import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { api } from "../api/client";
import type { Block, Track } from "../api/client";
import { usePersistentRatio } from "./ResizableSplit";
import { useStore } from "../store/useStore";

function fmtTs(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?[^#]*v=)([\w-]{6,})/,
    /(?:youtu\.be\/)([\w-]{6,})/,
    /(?:youtube\.com\/shorts\/)([\w-]{6,})/,
    /(?:youtube\.com\/embed\/)([\w-]{6,})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractFirstUrl(content: Record<string, unknown>): string | null {
  const text = JSON.stringify(content);
  const m = text.match(/https?:\/\/[^\s"\\]+/);
  return m ? m[0] : null;
}

function YouTubeEmbed({
  videoId,
  start,
  end,
}: {
  videoId: string;
  start?: number | null;
  end?: number | null;
}) {
  const [playing, setPlaying] = useState(false);
  if (playing) {
    const params = new URLSearchParams({ autoplay: "1" });
    if (start != null) params.set("start", String(Math.floor(start)));
    if (end != null) params.set("end", String(Math.ceil(end)));
    return (
      <div className="yt-embed">
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?${params}`}
          title="YouTube embed"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  return (
    <button className="yt-thumb" onClick={() => setPlaying(true)}>
      <img src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`} alt="YouTube thumbnail" />
      <span className="yt-play">▶</span>
    </button>
  );
}

function SectionBubbleMenu({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  return (
    <BubbleMenu editor={editor} className="bubble-menu">
      <button
        className={editor.isActive("bold") ? "bubble-active" : ""}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        B
      </button>
      <button
        className={editor.isActive("italic") ? "bubble-active" : ""}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        I
      </button>
      <button
        className={editor.isActive("strike") ? "bubble-active" : ""}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        S
      </button>
      <button
        className={editor.isActive("blockquote") ? "bubble-active" : ""}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        Quote
      </button>
      <button
        onClick={() => {
          const prev = editor.getAttributes("link").href as string | undefined;
          const url = window.prompt("Link URL", prev ?? "https://");
          if (url === null) return;
          if (url === "") editor.chain().focus().unsetLink().run();
          else editor.chain().focus().setLink({ href: url }).run();
        }}
      >
        Link
      </button>
    </BubbleMenu>
  );
}

function useBlockEditor(block: Block) {
  const updateBlockContent = useStore((s) => s.updateBlockContent);
  const blockRef = useRef(block);
  blockRef.current = block;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedAt = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: true }),
      Image,
    ],
    content:
      block.content && Object.keys(block.content).length > 0 ? block.content : "",
    editorProps: {
      attributes: { class: "editor-prose doc-prose" },
      handlePaste: (view, event) => {
        const file = Array.from(event.clipboardData?.files ?? []).find((f) =>
          f.type.startsWith("image/")
        );
        if (!file) return false;
        event.preventDefault();
        api.uploadImage(file).then((url) => {
          const { state, dispatch } = view;
          const node = state.schema.nodes.image.create({ src: url });
          dispatch(state.tr.replaceSelectionWith(node));
        });
        return true;
      },
    },
    onUpdate: ({ editor: e }) => {
      const current = blockRef.current;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const json = e.getJSON();
      saveTimer.current = setTimeout(() => {
        lastSavedAt.current = Date.now();
        updateBlockContent(current.id, json);
      }, 800);
    },
  });

  const agentFlash = useStore((s) => s.agentFlash[block.id]);
  useEffect(() => {
    if (!editor) return;
    if (agentFlash && agentFlash > lastSavedAt.current + 100) {
      const b = blockRef.current;
      const hasContent = b.content && Object.keys(b.content).length > 0;
      editor.commands.setContent(hasContent ? b.content : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentFlash, editor]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  return { editor, fileInputRef };
}

function useInViewportOnce() {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);
  return { ref, visible };
}

function VoSection({ block }: { block: Block; track: Track | undefined }) {
  const { updateBlock, deleteBlock, script, activeBlockId, hoverBlockId, presence } =
    useStore();
  const { editor, fileInputRef } = useBlockEditor(block);  const { ref, visible } = useInViewportOnce();
  const [titleDraft, setTitleDraft] = useState(block.title);

  const isActive = activeBlockId === block.id;
  const isHovered = hoverBlockId === block.id;
  const holder = presence[block.id];
  const estSeconds =
    block.word_count > 0 && script
      ? (block.word_count / (block.wpm_override ?? script.effective_wpm)) * 60
      : block.duration_seconds;

  return (
    <section
      ref={ref}
      className={`doc-section ${isActive ? "doc-section-active" : ""} ${
        isHovered && !isActive ? "doc-section-hover" : ""
      }`}
      data-block-id={block.id}
    >
      <header className="doc-section-header">
        <input
          className="doc-title-input"
          placeholder="Section title…"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => {
            if (titleDraft !== block.title) updateBlock(block.id, { title: titleDraft });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        <span className="doc-section-meta">
          {block.word_count} words · ~{fmtTs(estSeconds)}
          {holder && holder.holder !== "user" && (
            <span className="presence-badge">{holder.holder}</span>
          )}
        </span>
        <button
          className="doc-icon-btn"
          title="Insert image"
          onClick={() => fileInputRef.current?.click()}
        >
          Img
        </button>
        <button
          className="doc-icon-btn doc-icon-danger"
          title="Delete section"
          onClick={() => deleteBlock(block.id)}
        >
          ×
        </button>
      </header>
      {visible ? (
        <>
          <SectionBubbleMenu editor={editor} />
          <EditorContent editor={editor} />
        </>
      ) : (
        <p className="doc-placeholder">{block.content_markdown?.slice(0, 120) || "…"}</p>
      )}
      {block.editor_note && (
        <p className="doc-editor-note">Editor's note: {block.editor_note}</p>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && editor) {
            api.uploadImage(file).then((url) => {
              editor.chain().focus().setImage({ src: url }).run();
            });
          }
          e.target.value = "";
        }}
      />
    </section>
  );
}

function ClipCard({ block, track }: { block: Block; track: Track | undefined }) {
  const { updateBlock, deleteBlock, activeBlockId, hoverBlockId } = useStore();
  const isActive = activeBlockId === block.id;
  const isHovered = hoverBlockId === block.id;
  const ytId = extractYouTubeId(block.source_url);
  const contentUrl = !block.source_url ? extractFirstUrl(block.content) : null;
  const contentYtId = contentUrl ? extractYouTubeId(contentUrl) : null;
  const embedId = ytId ?? contentYtId;

  return (
    <section
      className={`doc-card ${isActive ? "doc-section-active" : ""} ${
        isHovered && !isActive ? "doc-section-hover" : ""
      }`}
      data-block-id={block.id}
      style={{ borderLeftColor: track?.color ?? "#555" }}
    >
      <header className="doc-card-header">
        <span className="doc-card-badges">
          {track && (
            <span className="doc-color-dot" style={{ background: track.color }} />
          )}
          {block.clip_kind && (
            <span className="doc-badge">{block.clip_kind.toUpperCase()}</span>
          )}
          <span className="doc-badge doc-badge-track">{track?.name ?? "Track"}</span>
          <span className="doc-timestamp">
            {fmtTs(block.start_seconds)} – {fmtTs(block.start_seconds + block.duration_seconds)}
          </span>
        </span>
        <button
          className="doc-icon-btn doc-icon-danger"
          title="Delete"
          onClick={() => deleteBlock(block.id)}
        >
          ×
        </button>
      </header>

      {embedId && (
        <YouTubeEmbed
          videoId={embedId}
          start={block.source_in_seconds}
          end={block.source_out_seconds}
        />
      )}

      {block.source_url && (
        <a
          className="doc-link-row"
          href={block.source_url}
          target="_blank"
          rel="noreferrer"
          title={block.source_url}
        >
          <span className="doc-link-text">{block.source_url}</span>
          <span className="doc-link-arrow">→</span>
        </a>
      )}

      <div className="doc-card-fields">
        <input
          className="doc-field doc-field-url"
          placeholder="Source URL"
          defaultValue={block.source_url}
          key={`url-${block.id}`}
          onBlur={(e) => {
            if (e.target.value !== block.source_url)
              updateBlock(block.id, { source_url: e.target.value });
          }}
        />
        <input
          className="doc-field doc-field-time"
          placeholder="in"
          title="Source in-point (seconds)"
          defaultValue={block.source_in_seconds ?? ""}
          key={`in-${block.id}`}
          onBlur={(e) => {
            const v = e.target.value === "" ? null : parseFloat(e.target.value);
            if (v !== block.source_in_seconds && (v === null || !Number.isNaN(v)))
              updateBlock(block.id, { source_in_seconds: v });
          }}
        />
        <input
          className="doc-field doc-field-time"
          placeholder="out"
          title="Source out-point (seconds)"
          defaultValue={block.source_out_seconds ?? ""}
          key={`out-${block.id}`}
          onBlur={(e) => {
            const v = e.target.value === "" ? null : parseFloat(e.target.value);
            if (v !== block.source_out_seconds && (v === null || !Number.isNaN(v)))
              updateBlock(block.id, { source_out_seconds: v });
          }}
        />
      </div>
      {block.content_markdown && <p className="doc-card-text">{block.content_markdown}</p>}
      <input
        className="doc-field doc-field-note"
        placeholder="Editor's note…"
        defaultValue={block.editor_note}
        key={`note-${block.id}`}
        onBlur={(e) => {
          if (e.target.value !== block.editor_note)
            updateBlock(block.id, { editor_note: e.target.value });
        }}
      />
    </section>
  );
}

export function DocumentPanel() {
  const { blocks, tracks, script, activeBlockId, hoverBlockId, revealInTimeline } = useStore();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; blockId: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scriptRatio, setScriptRatio] = usePersistentRatio("scriptedit_split_rail", 0.5);
  const [railDragging, setRailDragging] = useState(false);

  useEffect(() => {
    if (!railDragging) return;
    const onMove = (e: PointerEvent) => {
      const el = pageRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const inner = rect.width - 72 - 48;
      const pos = e.clientX - rect.left - 72 - 24;
      setScriptRatio(Math.min(0.85, Math.max(0.15, pos / inner)));
    };
    const onUp = () => setRailDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [railDragging, setScriptRatio]);

  const trackById = new Map(tracks.map((t) => [t.id, t]));

  const voBlocks = Object.values(blocks)
    .filter((b) => trackById.get(b.track)?.is_script_track)
    .sort((a, b) => a.start_seconds - b.start_seconds || a.id - b.id);
  const cardBlocks = Object.values(blocks)
    .filter((b) => !trackById.get(b.track)?.is_script_track)
    .sort((a, b) => a.start_seconds - b.start_seconds || a.id - b.id);

  const overlaps = (card: Block, vo: Block) =>
    card.start_seconds < vo.start_seconds + vo.duration_seconds &&
    card.start_seconds + card.duration_seconds > vo.start_seconds;

  const cardsByVo = new Map<number, Block[]>();
  const assigned = new Set<number>();
  for (const vo of voBlocks) {
    const related = cardBlocks.filter(
      (c) => c.anchor_block === vo.id || (c.anchor_block === null && overlaps(c, vo))
    );
    cardsByVo.set(vo.id, related);
    related.forEach((c) => assigned.add(c.id));
  }
  const orphans = cardBlocks.filter((c) => !assigned.has(c.id));
  for (const orphan of orphans) {
    const next =
      voBlocks.find((v) => v.start_seconds >= orphan.start_seconds) ??
      voBlocks[voBlocks.length - 1];
    if (next) cardsByVo.get(next.id)!.push(orphan);
  }

  useEffect(() => {
    if (activeBlockId === null) return;
    const el = scrollRef.current?.querySelector(`[data-block-id="${activeBlockId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeBlockId]);

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const onContextMenu = (e: React.MouseEvent) => {
    const section = (e.target as HTMLElement).closest("[data-block-id]");
    if (!section) return;
    e.preventDefault();
    const blockId = Number(section.getAttribute("data-block-id"));
    setContextMenu({ x: e.clientX, y: e.clientY, blockId });
  };

  if (!script) return null;

  const rowState = (vo: Block, cards: Block[]) => {
    const ids = [vo.id, ...cards.map((c) => c.id)];
    if (ids.includes(activeBlockId ?? -1)) return "doc-row-active";
    if (ids.includes(hoverBlockId ?? -1)) return "doc-row-hover";
    return "";
  };

  const gridColumns = `72px minmax(0, ${scriptRatio}fr) minmax(0, ${1 - scriptRatio}fr)`;
  const handleLeft = `calc(72px + 24px + (100% - 72px - 48px) * ${scriptRatio} - 3px)`;

  return (
    <div className="doc-panel" ref={scrollRef} onContextMenu={onContextMenu}>
      <div className="doc-page" ref={pageRef}>
        <h1 className="doc-script-title">{script.title}</h1>
        {voBlocks.map((vo) => {
          const cards = cardsByVo.get(vo.id) ?? [];
          return (
            <div
              key={vo.id}
              className={`doc-row ${rowState(vo, cards)}`}
              style={{ gridTemplateColumns: gridColumns }}
            >
              <div className="doc-gutter">
                <span className="doc-timestamp">
                  {fmtTs(vo.start_seconds)}
                  <br />–<br />
                  {fmtTs(vo.start_seconds + vo.duration_seconds)}
                </span>
              </div>
              <div className="doc-script-cell">
                <VoSection block={vo} track={trackById.get(vo.track)} />
              </div>
              <div className="doc-rail">
                {cards.map((c) => (
                  <ClipCard key={c.id} block={c} track={trackById.get(c.track)} />
                ))}
              </div>
            </div>
          );
        })}
        {voBlocks.length === 0 && (
          <p className="editor-empty">Add blocks on the timeline to build your script.</p>
        )}
        <div
          className={`doc-rail-handle ${railDragging ? "split-handle-active" : ""}`}
          style={{ left: handleLeft }}
          role="separator"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(e) => {
            e.preventDefault();
            setRailDragging(true);
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setScriptRatio(Math.max(0.15, scriptRatio - 0.02));
            if (e.key === "ArrowRight") setScriptRatio(Math.min(0.85, scriptRatio + 0.02));
          }}
        />
      </div>
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              revealInTimeline(contextMenu.blockId);
              setContextMenu(null);
            }}
          >
            Reveal in Timeline
          </button>
        </div>
      )}
    </div>
  );
}
