# ScriptEdit

A timeline-oriented scriptwriting app for faceless-documentary YouTube creators. Write your script as a chronological document while arranging voiceover, B-roll, and resource clips on a Premiere-Pro-style multi-track timeline — both views stay perfectly in sync.

Built **agent-first**: the backend is a headless state machine with a granular REST API, an auto-generated OpenAPI schema, and WebSocket broadcasts on every mutation, so AI agents can edit the script alongside you in real time.

![Stack](https://img.shields.io/badge/Django_6-DRF_+_Channels-092e20) ![Frontend](https://img.shields.io/badge/React_19-Vite_+_TS_+_TipTap-61dafb)

## Features

- **Document view (top):** your whole script as a chronological, Word-like document — chapters, serif narration text, styled quotes, editor's notes, images, YouTube embeds cued to in/out points, and clickable link cards. Everything is editable in place. Clicking any section automatically syncs it as active context for AI chat.
- **Timeline view (bottom):** multi-track lanes with saturated clips. Flexible row height resizing (down to 24px compact squeezing), draggable track column width resizer, word-count-based auto-width pacing (150 wpm default), drag to move/resize, overlapping clips fan out into sub-rows, wheel to pan, Ctrl/Cmd+wheel to zoom, draggable track reordering.

- **AI Script Editing Copilot (right sidebar):** VS Code / Antigravity IDE style chat panel powered by real-time LLM streaming (DeepSeek API `DEEPSEEK_API_KEY`, OpenAI, or Anthropic). Features **Strict Target Block Focus** (when a section is selected, AI focuses 100% of feedback, rewrites, and proposal cards on that block), **1-Click AI Suggestion Shortcuts** (`✨ AI Suggestion` buttons on section headers), and **Live Web Search & Deep Research Mode** (DuckDuckGo default, or optional `TAVILY_API_KEY`) for real-time fact checking, date verification, and B-roll video search. Full-script awareness by default with interactive target section syncing from Document review or Timeline, timeline timestamps (`[0:00 - 0:45]`), visual section badges (`🤖 Included in AI Chat`), clickable source citations, and interactive **Diff Proposal Cards** (`BEFORE` vs `AFTER`) with instant **Apply Edit** capabilities.


- **YouTube Video Clip Time-Range Preview:** hovering over or selecting any video clip card in the right rail triggers an enlarged top-right video preview box that automatically plays the exact trimmed clip segment (e.g., `0:54` → `0:57`) on a seamless loop, with time badges on thumbnail cards.
- **Two-way sync:** click a clip or section to scroll + highlight; visual AI target indicators; right-click a section → "Reveal in Timeline"; hover cross-highlighting.
- **Free-form tracks:** add, rename, recolor, reorder, delete tracks; toggle "script track" (word-count auto-width + anchor eligibility) per track.
- **VS Code-style splits:** drag the edge between document, timeline, and AI chat panel — split ratios persist.
- **One-click .docx import:** parses faceless-doc scripts (headings → chapters, prose → VO blocks, `(Muted Background Clip @ 0:54 - 0:57 URL)` → structured clip cards, quotes, links, embedded images).
- **Export:** timestamped plain-text script that mirrors the document, docx, or full JSON state.
- **Agent API:** token-authenticated granular endpoints (`move`, `resize`, `anchor`, attach tags/resources), OpenAPI 3.0 schema at `/api/schema/`, WebSocket events per script, presence badges for concurrent edits. Real-time streaming LLM chat endpoint at `/api/scripts/{id}/chat/` (set `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY` in `backend/.env`).


## Quick start

Prerequisites: Python 3.13, Node 22, PostgreSQL running locally.

```bash
# 1. Database
createdb scriptedit

# 2. Backend
cd backend
python3 -m venv .venv && .venv/bin/pip install django djangorestframework \
  django-cors-headers drf-spectacular channels channels_redis daphne \
  "psycopg[binary]" python-docx
cp .env.example .env # Set DEEPSEEK_API_KEY=sk-... in .env
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver 127.0.0.1:8000


# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. A demo project and script are auto-created on first load.

## Importing a script

- **UI:** click **Import** in the top nav and pick a `.docx`.
- **CLI:** `backend/.venv/bin/python manage.py import_docx <file.docx> --project "My Channel" --title "My Video"`

## Architecture

```
┌────────────────────────────────────────────┐
│  React 19 + TipTap + Zustand (Vite :5173)  │
│  DocumentPanel ⇄ TimelinePanel (2-way sync)│
└──────────────┬───────────────┬─────────────┘
          REST /api/        WS /ws/scripts/{id}/
┌──────────────┴───────────────┴─────────────┐
│  Django 6 + DRF + Channels (:8000)         │
│  Granular ViewSets + broadcast-on-mutate   │
│  drf-spectacular OpenAPI at /api/schema/   │
└──────────────┬─────────────────────────────┘
│  PostgreSQL (Project→Script→Track→Block)   │
└────────────────────────────────────────────┘
```

- **Auto-pacing:** blocks on script tracks size from `word_count / wpm`, capped at 600s.
- **Anchoring:** B-roll/resource blocks can anchor to a script block and follow it when it moves.
- **Echo-guard:** every client sends an `X-Client-Id`; WebSocket events carry an `actor` so clients ignore their own echoes.

See [AGENTS.md](AGENTS.md) for the full data model, API reference, WebSocket protocol, design system, and contributor conventions (also the onboarding doc for AI coding agents).

## License

MIT
