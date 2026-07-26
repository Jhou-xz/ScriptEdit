import { create } from "zustand";
import { api, OWN_ACTOR } from "../api/client";
import type {
  Block,
  Project,
  Resource,
  Script,
  ScriptState,
  Tag,
  Track,
} from "../api/client";

interface UndoEntry {
  label: string;
  undo: () => Promise<void>;
}

interface PresenceInfo {
  holder: string;
  expires: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  targetBlockId?: number | null;
  timestamp: number;
}

interface StoreState {
  project: Project | null;
  script: Script | null;
  scripts: Script[];
  tracks: Track[];
  blocks: Record<number, Block>;
  tags: Record<number, Tag>;
  resources: Record<number, Resource>;
  activeBlockId: number | null;
  hoverBlockId: number | null;
  revealSignal: { blockId: number; ts: number } | null;
  pxPerSecond: number;
  trackHeights: Record<number, number>;
  sidebarOpen: boolean;
  isChatOpen: boolean;
  isChatStreaming: boolean;
  webSearchEnabled: boolean;
  chatMessages: ChatMessage[];
  presence: Record<number, PresenceInfo>;
  agentFlash: Record<number, number>;
  undoStack: UndoEntry[];
  ws: WebSocket | null;

  bootstrap: () => Promise<void>;
  loadScript: (scriptId: number) => Promise<void>;
  applyState: (state: ScriptState) => void;
  connectWs: () => void;
  handleWsEvent: (event: { type: string; actor: string; object: unknown }) => void;

  toggleWebSearch: () => void;
  setActiveBlock: (id: number | null) => void;

  setHoverBlock: (id: number | null) => void;
  revealInTimeline: (blockId: number) => void;
  setPxPerSecond: (v: number) => void;
  setTrackHeight: (trackId: number, height: number | null) => void;
  toggleSidebar: () => void;
  toggleChat: () => void;
  setChatOpen: (open: boolean) => void;
  sendChatMessage: (content: string, targetBlockId?: number | null) => Promise<void>;
  requestBlockSuggestion: (blockId: number) => Promise<void>;
  clearChatMessages: () => void;


  updateBlockContent: (id: number, content: Record<string, unknown>) => Promise<void>;
  updateBlock: (id: number, data: Partial<Block>) => Promise<void>;
  moveBlock: (id: number, start: number, trackId?: number) => Promise<void>;
  resizeBlock: (id: number, duration: number) => Promise<void>;
  createBlock: (trackId: number, start: number) => Promise<void>;
  deleteBlock: (id: number) => Promise<void>;

  createTrack: (name: string) => Promise<void>;
  renameTrack: (id: number, name: string) => Promise<void>;
  toggleScriptTrack: (id: number) => Promise<void>;
  deleteTrack: (id: number) => Promise<void>;
  reorderTracks: (orderedIds: number[]) => Promise<void>;
  importScript: (file: File) => Promise<void>;
  createImageBlock: (voBlockId: number, imageUrl: string) => Promise<void>;

  attachTag: (blockId: number, tagId: number) => Promise<void>;
  detachTag: (blockId: number, tagId: number) => Promise<void>;
  attachResource: (blockId: number, resourceId: number) => Promise<void>;
  detachResource: (blockId: number, resourceId: number) => Promise<void>;
  createTag: (label: string) => Promise<void>;
  deleteTag: (id: number) => Promise<void>;
  createResource: (title: string, url: string, note: string) => Promise<void>;
  deleteResource: (id: number) => Promise<void>;

  undo: () => Promise<void>;
  pushUndo: (entry: UndoEntry) => void;
}


function indexById<T extends { id: number }>(items: T[]): Record<number, T> {
  return Object.fromEntries(items.map((i) => [i.id, i]));
}

export const useStore = create<StoreState>((set, get) => ({
  project: null,
  script: null,
  scripts: [],
  tracks: [],
  blocks: {},
  tags: {},
  resources: {},
  activeBlockId: null,
  hoverBlockId: null,
  revealSignal: null,
  pxPerSecond: 6,
  webSearchEnabled: false,

  trackHeights: (() => {
    try {
      return JSON.parse(localStorage.getItem("scriptedit_track_heights") ?? "{}");
    } catch {
      return {};
    }
  })(),
  sidebarOpen: true,
  isChatOpen: false,
  isChatStreaming: false,
  chatMessages: [],
  presence: {},
  agentFlash: {},
  undoStack: [],
  ws: null,


  bootstrap: async () => {
    let [project] = await api.listProjects();
    if (!project) project = await api.createProject({ name: "My Channel" });
    const scripts = await api.listScripts();
    let script = scripts.find((s) => s.project === project.id);
    if (!script)
      script = await api.createScript({ project: project.id, title: "Untitled Script" });
    set({ project, scripts });
    await get().loadScript(script.id);
  },

  loadScript: async (scriptId) => {
    const state = await api.getState(scriptId);
    get().applyState(state);
    get().connectWs();
  },

  applyState: (state) => {
    set({
      script: state.script,
      tracks: [...state.tracks].sort((a, b) => a.order - b.order),
      blocks: indexById(state.blocks),
      tags: indexById(state.tags),
      resources: indexById(state.resources),
      activeBlockId: null,
      presence: {},
    });
  },

  connectWs: () => {
    const { ws, script } = get();
    if (ws) ws.close();
    if (!script) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${proto}://${location.host}/ws/scripts/${script.id}/`);
    socket.onmessage = (e) => {
      try {
        get().handleWsEvent(JSON.parse(e.data));
      } catch {
        /* ignore malformed events */
      }
    };
    socket.onclose = () => {
      setTimeout(() => {
        if (get().ws === socket) get().connectWs();
      }, 1500);
    };
    set({ ws: socket });
  },

  handleWsEvent: ({ type, actor, object }) => {
    if (actor === "user" || actor === OWN_ACTOR) return;
    const { blocks, activeBlockId } = get();
    const obj = object as Block & { id?: number; block_id?: number };
    if (type === "block.created" || type === "block.updated" || type === "block.moved") {
      set({
        blocks: { ...get().blocks, [obj.id]: obj },
        agentFlash: { ...get().agentFlash, [obj.id]: Date.now() },
      });
    } else if (type === "block.deleted") {
      const next = { ...blocks };
      delete next[obj.id!];
      set({
        blocks: next,
        activeBlockId: activeBlockId === obj.id ? null : activeBlockId,
      });
    } else if (type === "tag.attached" || type === "tag.detached" || type.startsWith("resource.")) {
      set({ blocks: { ...get().blocks, [obj.id]: obj } });
    } else if (type.startsWith("presence.")) {
      const info = obj as unknown as { block_id: number; holder: string; expires: number };
      const presence = { ...get().presence };
      if (type === "presence.acquired") {
        presence[info.block_id] = { holder: info.holder, expires: info.expires };
      } else {
        delete presence[info.block_id];
      }
      set({ presence });
    }
  },

  setActiveBlock: (id) => {
    const { ws, activeBlockId } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (activeBlockId !== null && activeBlockId !== id) {
        ws.send(
          JSON.stringify({ type: "presence", action: "release", block_id: activeBlockId, holder: "user" })
        );
      }
      if (id !== null) {
        ws.send(
          JSON.stringify({ type: "presence", action: "acquire", block_id: id, holder: "user" })
        );
      }
    }
    set({ activeBlockId: id });
  },

  setHoverBlock: (id) => set({ hoverBlockId: id }),
  revealInTimeline: (blockId) => set({ revealSignal: { blockId, ts: Date.now() } }),

  setPxPerSecond: (v) => set({ pxPerSecond: Math.min(20, Math.max(1, v)) }),

  setTrackHeight: (trackId, height) => {
    const heights = { ...get().trackHeights };
    if (height === null) delete heights[trackId];
    else heights[trackId] = height;
    localStorage.setItem("scriptedit_track_heights", JSON.stringify(heights));
    set({ trackHeights: heights });
  },
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
  toggleChat: () => set({ isChatOpen: !get().isChatOpen }),
  toggleWebSearch: () => set({ webSearchEnabled: !get().webSearchEnabled }),
  setChatOpen: (open) => set({ isChatOpen: open }),
  clearChatMessages: () => set({ chatMessages: [] }),
  requestBlockSuggestion: async (blockId: number) => {
    set({ activeBlockId: blockId, isChatOpen: true });
    await get().sendChatMessage(
      "Analyze this specific section and give me concrete suggestions and rewrites to improve hook impact, pacing, tone, and visual B-roll alignment.",
      blockId
    );
  },
  sendChatMessage: async (content, targetBlockId) => {

    const { script, chatMessages, activeBlockId, webSearchEnabled } = get();
    if (!script) return;
    const targetId = targetBlockId !== undefined ? targetBlockId : activeBlockId;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      targetBlockId: targetId,
      timestamp: Date.now(),
    };

    const assistantMsgId = crypto.randomUUID();
    const initialAssistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      targetBlockId: targetId,
      timestamp: Date.now(),
    };

    const updatedMessages = [...chatMessages, userMsg, initialAssistantMsg];
    set({
      chatMessages: updatedMessages,
      isChatStreaming: true,
      isChatOpen: true,
    });

    const apiHistory = updatedMessages
      .slice(0, -1)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      await api.streamScriptChat(
        script.id,
        apiHistory,
        targetId,
        webSearchEnabled,
        (chunk) => {
          set((state) => ({
            chatMessages: state.chatMessages.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: m.content + chunk }
                : m
            ),
          }));
        }
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Error streaming response";
      set((state) => ({
        chatMessages: state.chatMessages.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: m.content || `⚠️ ${errorMsg}` }
            : m
        ),
      }));
    } finally {
      set({ isChatStreaming: false });
    }
  },


  pushUndo: (entry) => set({ undoStack: [...get().undoStack.slice(-49), entry] }),

  undo: async () => {
    const stack = [...get().undoStack];
    const entry = stack.pop();
    set({ undoStack: stack });
    if (entry) await entry.undo();
  },

  updateBlockContent: async (id, content) => {
    const prev = get().blocks[id];
    const updated = await api.updateBlock(id, { content });
    set({ blocks: { ...get().blocks, [id]: updated } });
    if (prev) {
      get().pushUndo({
        label: "edit content",
        undo: async () => {
          const reverted = await api.updateBlock(id, { content: prev.content });
          set({ blocks: { ...get().blocks, [id]: reverted } });
        },
      });
    }
  },

  updateBlock: async (id, data) => {
    const updated = await api.updateBlock(id, data);
    set({ blocks: { ...get().blocks, [id]: updated } });
  },

  moveBlock: async (id, start, trackId) => {
    const prev = get().blocks[id];
    if (prev) {
      set({
        blocks: {
          ...get().blocks,
          [id]: { ...prev, start_seconds: start, track: trackId ?? prev.track },
        },
      });
    }
    const updated = await api.moveBlock(id, start, trackId);
    set({ blocks: { ...get().blocks, [id]: updated } });
    if (prev) {
      get().pushUndo({
        label: "move block",
        undo: async () => {
          const reverted = await api.moveBlock(id, prev.start_seconds, prev.track);
          set({ blocks: { ...get().blocks, [id]: reverted } });
        },
      });
    }
  },

  resizeBlock: async (id, duration) => {
    const prev = get().blocks[id];
    if (prev) {
      set({
        blocks: { ...get().blocks, [id]: { ...prev, duration_seconds: duration } },
      });
    }
    const updated = await api.resizeBlock(id, duration);
    set({ blocks: { ...get().blocks, [id]: updated } });
    if (prev) {
      get().pushUndo({
        label: "resize block",
        undo: async () => {
          const reverted = await api.resizeBlock(id, prev.duration_seconds);
          set({ blocks: { ...get().blocks, [id]: reverted } });
        },
      });
    }
  },

  createBlock: async (trackId, start) => {
    const block = await api.createBlock({ track: trackId, start_seconds: start });
    set({ blocks: { ...get().blocks, [block.id]: block }, activeBlockId: block.id });
    get().pushUndo({
      label: "create block",
      undo: async () => {
        await api.deleteBlock(block.id);
        const next = { ...get().blocks };
        delete next[block.id];
        set({ blocks: next, activeBlockId: null });
      },
    });
  },

  deleteBlock: async (id) => {
    const prev = get().blocks[id];
    await api.deleteBlock(id);
    const next = { ...get().blocks };
    delete next[id];
    set({ blocks: next, activeBlockId: get().activeBlockId === id ? null : get().activeBlockId });
    if (prev) {
      get().pushUndo({
        label: "delete block",
        undo: async () => {
          const restored = await api.createBlock({
            track: prev.track,
            start_seconds: prev.start_seconds,
            content: prev.content,
          });
          await api.resizeBlock(restored.id, prev.duration_seconds);
          const final = await api.updateBlock(restored.id, {});
          set({ blocks: { ...get().blocks, [restored.id]: final } });
        },
      });
    }
  },

  createTrack: async (name) => {
    const { script, tracks } = get();
    if (!script) return;
    const track = await api.createTrack({
      script: script.id,
      name,
      kind: name.toLowerCase().replace(/\s+/g, "-"),
      order: tracks.length,
    });
    set({ tracks: [...tracks, track] });
  },

  renameTrack: async (id, name) => {
    const track = await api.updateTrack(id, { name });
    set({ tracks: get().tracks.map((t) => (t.id === id ? track : t)) });
  },

  toggleScriptTrack: async (id) => {
    const current = get().tracks.find((t) => t.id === id);
    if (!current) return;
    const track = await api.updateTrack(id, { is_script_track: !current.is_script_track });
    set({ tracks: get().tracks.map((t) => (t.id === id ? track : t)) });
  },

  deleteTrack: async (id) => {
    await api.deleteTrack(id);
    const removedBlockIds = new Set(
      Object.values(get().blocks)
        .filter((b) => b.track === id)
        .map((b) => b.id)
    );
    const blocks = Object.fromEntries(
      Object.entries(get().blocks).filter(([bid]) => !removedBlockIds.has(Number(bid)))
    );
    const activeBlockId =
      get().activeBlockId !== null && removedBlockIds.has(get().activeBlockId!)
        ? null
        : get().activeBlockId;
    set({ tracks: get().tracks.filter((t) => t.id !== id), blocks, activeBlockId });
  },

  reorderTracks: async (orderedIds) => {
    const prev = get().tracks;
    const byId = new Map(prev.map((t) => [t.id, t]));
    const optimistic = orderedIds
      .map((id, i) => {
        const t = byId.get(id);
        return t ? { ...t, order: i } : null;
      })
      .filter((t) => t !== null);
    set({ tracks: optimistic });
    await Promise.all(
      optimistic.map((t, i) => {
        const original = byId.get(t.id);
        if (original && original.order !== i) {
          return api.updateTrack(t.id, { order: i });
        }
        return Promise.resolve(t);
      })
    );
  },

  importScript: async (file: File) => {
    const { script } = await api.importDocx(file);
    set({ scripts: [...get().scripts, script] });
    await get().loadScript(script.id);
  },

  createImageBlock: async (voBlockId, imageUrl) => {
    const { tracks, blocks } = get();
    const vo = blocks[voBlockId];
    const imagesTrack = tracks.find((t) => t.kind === "images");
    if (!vo || !imagesTrack) return;
    const siblings = Object.values(blocks).filter(
      (b) => b.track === imagesTrack.id && b.anchor_block === voBlockId
    );
    const start = Math.max(
      vo.start_seconds,
      ...siblings.map((b) => b.start_seconds + b.duration_seconds + 1)
    );
    const block = await api.createBlock({
      track: imagesTrack.id,
      start_seconds: start,
      duration_seconds: 8,
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "image", attrs: { src: imageUrl } }] },
        ],
      },
    });
    const anchored = await api.anchorBlock(block.id, voBlockId);
    set({ blocks: { ...get().blocks, [anchored.id]: anchored } });
  },

  attachTag: async (blockId, tagId) => {
    const updated = await api.attachTag(blockId, tagId);
    set({ blocks: { ...get().blocks, [blockId]: updated } });
  },
  detachTag: async (blockId, tagId) => {
    const updated = await api.detachTag(blockId, tagId);
    set({ blocks: { ...get().blocks, [blockId]: updated } });
  },
  attachResource: async (blockId, resourceId) => {
    const updated = await api.attachResource(blockId, resourceId);
    set({ blocks: { ...get().blocks, [blockId]: updated } });
  },
  detachResource: async (blockId, resourceId) => {
    const updated = await api.detachResource(blockId, resourceId);
    set({ blocks: { ...get().blocks, [blockId]: updated } });
  },

  createTag: async (label) => {
    const { project, tags } = get();
    if (!project) return;
    const tag = await api.createTag({ project: project.id, label });
    set({ tags: { ...tags, [tag.id]: tag } });
  },
  deleteTag: async (id) => {
    await api.deleteTag(id);
    const next = { ...get().tags };
    delete next[id];
    set({ tags: next });
  },
  createResource: async (title, url, note) => {
    const { project, resources } = get();
    if (!project) return;
    const resource = await api.createResource({ project: project.id, title, url, note });
    set({ resources: { ...resources, [resource.id]: resource } });
  },
  deleteResource: async (id) => {
    await api.deleteResource(id);
    const next = { ...get().resources };
    delete next[id];
    set({ resources: next });
  },
}));
