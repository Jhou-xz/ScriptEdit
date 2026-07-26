const API_BASE = "/api";

localStorage.removeItem("scriptedit_token");

const CLIENT_ID_KEY = "scriptedit_client_id";
let clientId = localStorage.getItem(CLIENT_ID_KEY);
if (!clientId) {
  clientId = crypto.randomUUID();
  localStorage.setItem(CLIENT_ID_KEY, clientId);
}
export const OWN_ACTOR = `client:${clientId}`;

export interface Project {
  id: number;
  name: string;
  default_wpm: number;
  created_at: string;
}

export interface Script {
  id: number;
  project: number;
  title: string;
  status: "draft" | "final";
  target_length_min: number | null;
  wpm_override: number | null;
  effective_wpm: number;
  created_at: string;
  updated_at: string;
}

export interface Track {
  id: number;
  script: number;
  kind: string;
  name: string;
  order: number;
  color: string;
  is_script_track: boolean;
}

export interface Block {
  id: number;
  track: number;
  title: string;
  clip_kind: "" | "muted" | "clip" | "full";
  source_url: string;
  source_in_seconds: number | null;
  source_out_seconds: number | null;
  editor_note: string;
  start_seconds: number;
  duration_seconds: number;
  content: Record<string, unknown>;
  content_markdown: string;
  word_count: number;
  wpm_override: number | null;
  anchor_block: number | null;
  anchor_offset_seconds: number;
  color_tag: string;
  tag_ids: number[];
  resource_ids: number[];
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: number;
  project: number;
  label: string;
  color: string;
  block_ids: number[];
}

export interface Resource {
  id: number;
  project: number;
  title: string;
  url: string;
  note: string;
  block_ids: number[];
}

export interface ScriptState {
  script: Script;
  tracks: Track[];
  blocks: Block[];
  tags: Tag[];
  resources: Resource[];
}

let authToken: string | null = null;

export function setAuthToken(token: string) {
  authToken = token;
  localStorage.setItem("scriptedit_token", token);
}

export function getAuthToken() {
  return authToken;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Client-Id": clientId!,
    ...(options.headers as Record<string, string>),
  };
  if (authToken) headers["Authorization"] = `Token ${authToken}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

export const api = {
  listProjects: () => request<Project[]>("/projects/"),
  createProject: (data: Partial<Project>) =>
    request<Project>("/projects/", { method: "POST", body: JSON.stringify(data) }),
  listScripts: () => request<Script[]>("/scripts/"),
  createScript: (data: Partial<Script>) =>
    request<Script>("/scripts/", { method: "POST", body: JSON.stringify(data) }),
  getState: (scriptId: number) => request<ScriptState>(`/scripts/${scriptId}/state/`),

  createBlock: (data: Partial<Block>) =>
    request<Block>("/blocks/", { method: "POST", body: JSON.stringify(data) }),
  updateBlock: (id: number, data: Partial<Block>) =>
    request<Block>(`/blocks/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteBlock: (id: number) => request<void>(`/blocks/${id}/`, { method: "DELETE" }),
  moveBlock: (id: number, start_seconds: number, track_id?: number) =>
    request<Block>(`/blocks/${id}/move/`, {
      method: "PATCH",
      body: JSON.stringify({ start_seconds, track_id }),
    }),
  resizeBlock: (id: number, duration_seconds: number) =>
    request<Block>(`/blocks/${id}/resize/`, {
      method: "PATCH",
      body: JSON.stringify({ duration_seconds }),
    }),
  anchorBlock: (id: number, anchor_block: number, offset_seconds = 0) =>
    request<Block>(`/blocks/${id}/anchor/`, {
      method: "POST",
      body: JSON.stringify({ anchor_block, offset_seconds }),
    }),
  unanchorBlock: (id: number) =>
    request<Block>(`/blocks/${id}/anchor/`, { method: "DELETE" }),

  attachTag: (blockId: number, tagId: number) =>
    request<Block>(`/blocks/${blockId}/tags/${tagId}/`, { method: "POST" }),
  detachTag: (blockId: number, tagId: number) =>
    request<Block>(`/blocks/${blockId}/tags/${tagId}/`, { method: "DELETE" }),
  attachResource: (blockId: number, resourceId: number) =>
    request<Block>(`/blocks/${blockId}/resources/${resourceId}/`, { method: "POST" }),
  detachResource: (blockId: number, resourceId: number) =>
    request<Block>(`/blocks/${blockId}/resources/${resourceId}/`, { method: "DELETE" }),

  createTag: (data: Partial<Tag>) =>
    request<Tag>("/tags/", { method: "POST", body: JSON.stringify(data) }),
  deleteTag: (id: number) => request<void>(`/tags/${id}/`, { method: "DELETE" }),
  createResource: (data: Partial<Resource>) =>
    request<Resource>("/resources/", { method: "POST", body: JSON.stringify(data) }),
  deleteResource: (id: number) => request<void>(`/resources/${id}/`, { method: "DELETE" }),

  createTrack: (data: Partial<Track>) =>
    request<Track>("/tracks/", { method: "POST", body: JSON.stringify(data) }),
  updateTrack: (id: number, data: Partial<Track>) =>
    request<Track>(`/tracks/${id}/`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteTrack: (id: number) => request<void>(`/tracks/${id}/`, { method: "DELETE" }),

  uploadImage: async (file: File): Promise<string> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/media/`, {
      method: "POST",
      body: form,
      headers: { "X-Client-Id": clientId! },
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    const data = (await res.json()) as { url: string };
    return data.url;
  },

  importDocx: async (
    file: File,
    title?: string
  ): Promise<{ script: Script; stats: Record<string, number> }> => {
    const form = new FormData();
    form.append("file", file);
    if (title) form.append("title", title);
    const res = await fetch(`${API_BASE}/scripts/import/`, {
      method: "POST",
      body: form,
      headers: { "X-Client-Id": clientId! },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Import failed: ${res.status} ${body}`);
    }
    return res.json();
  },

  exportUrl: (scriptId: number, format: "text" | "json") =>
    `${API_BASE}/scripts/${scriptId}/export/?fmt=${format}`,

  streamScriptChat: async (
    scriptId: number,
    messages: Array<{ role: string; content: string }>,
    targetBlockId: number | null,
    webSearch: boolean = false,
    onChunk: (text: string) => void
  ): Promise<void> => {
    const res = await fetch(`${API_BASE}/scripts/${scriptId}/chat/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": clientId!,
      },
      body: JSON.stringify({ messages, target_block_id: targetBlockId, web_search: webSearch }),
    });

    if (!res.ok) throw new Error(`Chat failed: ${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) return;
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          const dataStr = trimmed.slice(6);
          if (dataStr === "[DONE]") return;
          try {
            const parsed = JSON.parse(dataStr) as { text?: string };
            if (parsed.text) onChunk(parsed.text);
          } catch {
            // ignore
          }
        }
      }
    }
  },
};

