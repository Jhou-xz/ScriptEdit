# ScriptEdit — Agent Guide

Timeline-oriented scriptwriting app for faceless-documentary YouTube creators. Two-pane UI: a Word-like **document view** (top, synchronized two-column layout) and a Premiere-Pro-style **multi-track timeline** (bottom). Backend is a headless, agent-first state machine: everything the UI does is a granular REST call, and every mutation broadcasts a WebSocket event so AI agents and the UI stay in sync.

## Stack

- **Backend:** Django 6 + DRF + drf-spectacular + Channels (daphne), PostgreSQL (`scriptedit` DB, localhost trust auth), Python 3.13 venv at `backend/.venv`.
- **Frontend:** Vite + React 19 + TypeScript, Zustand, TipTap 3 (rich text). Dev server :5173 proxies `/api` and `/ws` to :8000.
- **Channel layer:** InMemory by default (single process). Set `REDIS_URL` env to switch to Redis (needed for multi-process; note: channels_redis timed out against Redis 8.6 locally).

## Run

```bash
# backend (from backend/)
.venv/bin/python manage.py runserver 127.0.0.1:8000
# frontend (from frontend/)
npm run dev
```

Verify: `npm run build` (frontend), `curl localhost:8000/api/schema/` (backend). API docs at `/api/docs/`.

## Directory layout

```
backend/
  config/         settings.py (AllowAny auth, CORS all, InMemory channels, loads .env), urls.py, asgi.py
  api/
    models.py     Project → Script → Track → Block (+ Tag/Resource legacy M2M)
    views.py      ViewSets + script state/export/import/auto_layout/chat actions
    serializers.py
    markdown.py   TipTap JSON → plaintext/markdown/word_count
    broadcast.py  WebSocket broadcast + actor_from_request
    consumers.py  ScriptConsumer at ws/scripts/{id}/
    services/
      docx_import.py  .docx parser → tracks/blocks (shared by command + endpoint)
      ai_chat.py      LLM Script Editing Copilot SSE streaming (DEEPSEEK_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY)
      ai_search.py    Live Web Search & Fact-Checking service (DuckDuckGo default, TAVILY_API_KEY optional)
      ai_layout.py    LLM auto-layout service
    management/commands/import_docx.py
frontend/src/
  api/client.ts       typed API client, streamScriptChat SSE helper, clientId echo-guard, OWN_ACTOR
  store/useStore.ts   Zustand store: all state + chat state + all mutations + undo stack + WS handler
  components/
    TopNav.tsx        brand + script switcher (left), AI Assistant toggle + Import/Export (right)
    DocumentPanel.tsx document view: VoSection, ClipCard, YouTubeEmbed, ClipPopupPreview, BubbleMenu
    TimelinePanel.tsx custom timeline: lanes, sub-rows, drag/resize, wheel pan/zoom
    AiChatPanel.tsx   AI Assistant sidebar: Astryx Chat UI, context banner, target badges, research toggle, diff proposal cards
  theme/tokens.css    design tokens (dark Premiere-style)
  app.css             all component styles
apple/DESIGN.md       Apple design-system reference (grammar only; UI is dark Premiere-style)
```


## Data model (backend/api/models.py)

- **Project** `name, default_wpm (150)`
- **Script** `project FK, title, status, target_length_min, wpm_override` → `effective_wpm`
- **Track** `script FK, kind (free string), name, order, color (auto palette), is_script_track`. Fully user-managed (add/rename/delete/reorder via order). `KIND_DEFAULT_NAMES` seeds new scripts with 4 tracks: voiceover (script track), broll, resources, images. **No "Tags & SEO" track** (removed deliberately). Images track holds image blocks (`content` = TipTap doc with an `image` node; anchored to their VO block) — pictures never live inline in VO prose.
- **Block** `track FK, title, start_seconds, duration_seconds, content (TipTap JSON), content_markdown, word_count, wpm_override, anchor_block (self FK, must be on script track), anchor_offset_seconds, clip_kind (''|muted|clip|full), source_url, source_in_seconds, source_out_seconds, editor_note, color_tag, version`
  - `is_script_track` track ⇒ `duration_seconds = word_count / wpm * 60`, capped at 600s, recomputed server-side on every content save. Other tracks: manual duration.
  - Moving a script-track block shifts its anchored children by the same delta (server-side).
  - `content_markdown` + `word_count` are denormalized server-side on save — always recompute them if you save `content` outside the API (see `views._refresh_block_content_fields`).
  - `version` optimistic guard: PATCH with `version` field → 400 if stale.
- **Tag / Resource** (project-level, M2M to blocks): legacy — no UI, keep API for agents.

## API conventions

- Base `/api/`, OpenAPI at `/api/schema/` (drf-spectacular). Router viewsets: projects, scripts, tracks, blocks, tags, resources.
- Auth: **AllowAny** (local single-user). Agents may send `Authorization: Token <key>` — it only affects the `actor` label in WS events.
- Key endpoints:
  - `GET /api/scripts/{id}/state/` — full nested state (initial load).
  - `PATCH /api/blocks/{id}/move/` `{start_seconds, track_id?}` · `PATCH .../resize/` `{duration_seconds}`
  - `POST/DELETE /api/blocks/{id}/anchor/`
  - `POST/DELETE /api/blocks/{id}/tags/{tag_id}/`, `.../resources/{resource_id}/`
  - `GET /api/scripts/{id}/export/?fmt=docx|text|json` — NOTE: param is `fmt`, not `format` (`?format=` collides with DRF content negotiation and 404s on `text`). `docx` (default in UI) mirrors the faceless-doc format via `services/docx_export.py` (headings, prose, clip parens, quotes, bare URLs, embedded images).
  - `POST /api/scripts/import/` (multipart `file`=.docx) — creates a new script from a faceless-doc script.
  - `POST /api/scripts/{id}/auto_layout/` — LLM layout suggestions.
  - `POST /api/scripts/{id}/chat/` — SSE streaming Script Editing Copilot endpoint (`text/event-stream`). Takes `{messages: [...], target_block_id: int|null, web_search: bool}`. Uses `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` from `backend/.env`.
  - `POST /api/media/` (multipart image) → `{url}` for editor images.

- Every response is the updated object; every mutation broadcasts.


## WebSocket protocol

`ws://host/ws/scripts/{script_id}/` → events `{type, actor, object}`:
- `block.created|updated|moved|deleted`, `tag.attached|detached`, `resource.attached|detached`, `presence.acquired|released`.
- `actor`: `"user"` (no id), `"client:{uuid}"` (frontend's `X-Client-Id` header), or `"agent:{token}"`. **Clients must ignore events with their own actor** (frontend: `OWN_ACTOR` in client.ts).
- Client→server messages: `{type:"presence", action:"acquire"|"release", block_id, holder}`.

## Frontend conventions

- **All server mutations go through `useStore`** — never call `api.*` directly from components (store handles optimistic update + undo + state). WS events only update state for *other* actors.
- Drag move/resize is optimistic (store updates before API resolves) — prevents snap-back flicker.
- Timeline: `pxPerSecond` zoom (1–20); wheel over timeline = horizontal pan, Ctrl/Cmd+wheel = zoom; overlapping clips get sub-rows via `layoutRows()` (interval partitioning, max 3).
- Document view: grid row = one VO block + its overlapping/anchored cards (gutter 72px / script / 340px rail). Row highlight on `activeBlockId`/`hoverBlockId`; right-click → "Reveal in Timeline".
- Per-block TipTap editors with 800ms debounced save. **Gotcha:** editor `onUpdate` must read the block from a ref (`blockRef`), not closure state — a captured `null` once silently broke all saving.
- Session undo (Cmd+Z) is store-based; global handler must skip `input/textarea/select/.ProseMirror` focus.
- Stale `scriptedit_token` localStorage is cleared on boot (auth removed); `scriptedit_client_id` persists for echo-guard.

## Design system

Dark Premiere-Pro surfaces + Apple grammar. Tokens in `frontend/src/theme/tokens.css`:
- Surfaces: `#1e1e1e` app, `#232323` panel, `#191919` recessed, hairlines `#3a3a3a`/`#0e0e0e`. Single accent `#2997ff` (selection, focus, links) — **no second accent color**.
- Fonts: Inter (UI, 13–14px) + Source Serif 4 (script text, 18px/1.6) via Google Fonts, SF Pro system fallbacks. Weights 300/400/600/700 only.
- Clips: saturated per-track fill (`track.color`), white 12.5px labels, `#2997ff` outline when selected.
- No decorative shadows/gradients; `transform: scale(0.95)` press states; radius xs 5 / sm 8 / pill.

## Import format (services/docx_import.py)

Deterministic parser for the user's script format: headings → chapter-titled VO blocks; prose → VO paragraphs (flush ~every 6); `(Muted Background Clip @ 0:54 - 0:57 URL)` / `(Clip @ …)` / `(Full Clip URL)` → broll blocks with structured clip fields; `"quote"` + URL → blockquote + link; bare URLs → resource blocks; note-only parens → `editor_note`; embedded images → **images-track blocks** (anchored, cascaded). Clips cascade sequentially per VO block (`clip_cursor`) — **never stack clips at identical timestamps** (invisible overlaps confused users).

Frontend image flow: paste/"Img" button in the editor uploads via `/api/media/` then calls `createImageBlock(voBlockId, url)` (images-track block, anchored) — never inserts inline `<img>`. Vite proxies `/media` to Django or images 404 in dev.

## Common tasks

- **Add an API endpoint:** extend a ViewSet `@action` → serializer → broadcast if mutating → it auto-appears in `/api/schema/`.
- **Add a block field:** model → `makemigrations` → `BlockSerializer.fields` → frontend `Block` interface in client.ts.
- **DB access:** `backend/.venv/bin/python manage.py shell -c "..."` (Postgres `scriptedit`, no password).
- **Test data:** the Jeremy Fragrance docx at repo root is the canonical import fixture.

## Verification checklist after changes

1. `cd frontend && npm run build` (tsc + vite).
2. `curl localhost:8000/api/scripts/{id}/state/` returns 200.
3. Mutate a block via curl → confirm WS event (see broadcast test pattern in git history or use `websockets` lib).
4. Browser E2E via ego-browser skill if UI changed.

<!-- ASTRYX:START -->
Astryx v0.1.8 · 90+ components
CLI: run every command as `npx @astryxdesign/cli <cmd>` (shown below as `astryx ...`).

SETUP (once, in your app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — discover, don't guess. Before writing UI:
1. `astryx build "<idea>"` — START HERE: returns a kit (closest [page] + [block]s + [component]s). No args = full playbook.
2. `astryx template <name> [--skeleton]` — scaffold the [page]/[block]s it named, or study their layout. Templates are reference code.
3. `astryx component <Name>` — props + examples for every component you use.

RULES:
- No <div> — components do all layout/spacing. Full page → AppShell; sidebar nav → SideNav.
- Frame first: pick the shell (AppShell / Layout+LayoutPanel) and budget regions in px BEFORE writing content (`astryx docs layout`).
- Dense data = rows (Table, List/Item) edge-to-edge — never Card-wrapped list items. Card = dashboard widgets, galleries, settings groups only.
- Status → StatusDot/Token; Badge only for counts and enumerated states, never decoration.
- Custom styling: component props first; else style/className with tokens — var(--color-*|--spacing-*|--radius-*). No raw hex/px. (No StyleX/Tailwind compiler here — don't use xstyle/utility classes.)
- Tokens for every value (`astryx docs tokens`). Brand/accent via `astryx theme` — never override --color-* in :root.
- SELF-CHECK before you finish: re-read the file and replace any raw <div>/<span> layout, imported .css/@apply, or hardcoded value (#hex, 16px) with the component or a token (var(--color-*|--spacing-*|…)). If unsure a component/prop exists, run `astryx component <Name>` / `astryx search "<thing>"`; don't hand-roll CSS.

MORE CLI:
  search "<query>"   find any component / hook / doc / template / block
  component --list   90+ components by category
  template --list    page + block recipes
  docs <topic>       color, elevation, icons, illustrations, internationalization, layout, migration, motion, principles, shape, spacing, styling, theme, tokens, typography
  swizzle <Name>     eject component source for deep customization
  upgrade --apply    run after any @astryxdesign/core bump
<!-- ASTRYX:END -->
