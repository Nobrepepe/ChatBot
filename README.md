# Character Chat

A desktop app for chatting with your fictional characters in a visual-novel-style
interface, powered by local AI models. Built with Electron, TypeScript, React and Vite.

Create worlds, give them characters with prompt-ready profiles, set up scenes
(title, what happened previously, mode), and chat. Approved canon and relationship
memories are injected into every prompt, so characters develop over time instead of
starting fresh each session.

## Features

- **Worlds**: cover and scene-fallback art, setting descriptions, style guides,
  and a **lorebook** — modular lore entries injected into prompts only when their
  keywords appear in the scene title or recent messages
- **Characters**: structured 8-section profile (appearance, personality, backstory,
  behavior rules, voice, relationship to you, direct AI instructions, sprites),
  a portrait, and a 16:9 shelf image; **custom sprites** carry a call sign such as
  `sad` or `sword-attack` — when a reply starts with `[sad]` the portrait swaps
- **Scenes**: cast (one or several characters), a title, a **previously on**
  field carrying summaries of earlier scenes, your **persona**, an optional
  **narrator**, and a mode: *Roleplay*, *Interview*, or *Author assistant*.
  **Invite character** brings someone else in mid-scene, and a finished scene
  continues into the next part of its series — *The rooftop - Part II* —
  carrying its summary in
- **Scene templates**: save a setup and start future scenes from it
- **Multi-character scenes**: characters reply in labeled turns with distinct
  voices; a **Choose responder** action lets one character answer another directly
- **Two display modes per scene**: rolling chat, or **visual novel mode** showing
  the latest line over the scene art with a backlog viewer
- **Response controls**: regenerate, edit, delete, **Stop** mid-generation,
  save any reply as a memory, **Impersonate** (draft your persona's next turn),
  and **Save & continue** — trim a reply in the editor and the AI finishes it
  without regenerating what you kept
- **Memory / canon system**: canon facts and relationship state per character,
  injected into every prompt. **Memory proposals** work like the note proposals
  below: the model is shown what the character already remembers, with stable
  ids, and proposes *remember / rewrite / forget* actions — so a changed
  relationship rewrites the memory that is there instead of contradicting it.
  Every action waits for your approval. Scene summaries cover the history
  falling outside the context window
- **Automatic passes** (off by default): a summary and a memory review that run
  themselves every few replies, like an autosave. Sending stays locked until the
  pass finishes, so the turn cannot stack on top of it — at the cost of a
  noticeably longer reply on the turns one runs
- **Worldbuilding notes**: a private notes workspace per world — never sent with
  scene prompts. The AI workspace pairs a writing-assistant conversation with the
  note browser: per-note context modes (always / when relevant / excluded),
  live "N notes in context" transparency, and AI **note proposals**
  (create / append / replace) that require your review before becoming canon.
  `Ctrl+K` finds a note from anywhere in the workspace
- **Chat export**: save any scene as a Markdown transcript
- **Prompt debug panel**: every prompt section (including which lore entries
  matched and why) and the exact payload sent to the model
- **Provider**: any OpenAI-compatible endpoint — Ollama, LM Studio,
  llama.cpp server, KoboldCpp…

## Development

```bash
npm install
npm run dev        # launch with hot reload
npm test           # run the test suite (uses Electron's Node runtime)
npm run dist       # build a packaged app into release/
```

`npm test` runs Vitest through Electron's bundled Node so `better-sqlite3`
only ever needs to be compiled for one ABI. If the native module complains
after an Electron upgrade, run `npx electron-rebuild -f -o better-sqlite3`.

## Connecting a local model

Open **Settings** and set the base URL:

| Server    | Base URL                     |
|-----------|------------------------------|
| Ollama    | `http://localhost:11434/v1`  |
| LM Studio | `http://localhost:1234/v1`   |
| llama.cpp | `http://localhost:8080/v1`   |

*Test the connection →* lists the models available on the server; pick one and
save. Temperature, top-p, max tokens, streaming, and the history window are
configurable there too, along with a global system prompt sent before the
generated character, world, scene, lore, and memory context.

No model running? Try the bundled mock server to explore the app:

```bash
npm run mock       # serves http://localhost:8111/v1
```

## Data & assets

- Everything is stored locally under the app's user-data directory
  (`~/.config/character-chat` on Linux): `data/chatbot.db` (SQLite),
  `data/exports/`, `data/worldhub-content/`, and `media/` for imported art
- Set `CHATBOT_DATA_DIR` to relocate everything (tests use per-run temp dirs)
- Imported images are copied into the media store and served over a sandboxed
  `media://` protocol; the database stores relative paths only
- The display and body typefaces (Newsreader, IBM Plex Sans) are bundled, so
  the UI needs no network access to render

## Project layout

```text
src/main/          Electron main process
  db/              SQLite schema, migrations, repositories
  prompt/          prompt builders (scene, aux, notes workspace)
  providers/       OpenAI-compatible endpoint client
  services/        chat + notes orchestration, asset importing
  worldhub/        World Hub package reader and consumer
  ipc/             typed IPC registration and streaming
src/preload/       contextBridge surface
src/renderer/      React app (screens, components, styles)
src/shared/        types, IPC contract, wire-format parsing
scripts/mock-server.mjs   fake OpenAI-compatible endpoint
tests/main/        Vitest suites (node env) incl. World Hub conformance
tests/renderer/    Vitest suites (jsdom)
```

## World Hub content

Character Chat consumes World Hub publications (Package Protocol 1,
Application Contract 1). The authoritative contract lives at
`worldhub/application-contract.json`.

- **Install** — Settings → World Hub → *Install publication ZIP →*, or link a
  World Hub production folder (the one containing `current.json`) and use
  *Check for update →*. Packages are validated completely in staging (safe
  paths, manifest, embedded contract, checksums, references) before anything
  changes; a rejected package changes nothing.
- **Hub mode** — canonical worlds, characters, and lore become read-only Hub
  content; linked Hub Markdown becomes lore with derived trigger keywords you
  can tune locally. Personas, scenes, memories, and private notes stay editable
  and local, and are never written back to the Hub.
- **Pinning** — every conversation is pinned to the publication that was active
  when it began, so an update never changes character behavior mid-story.
  Retired characters stay visible in their old conversations but cannot start
  new ones. Each pinned conversation offers an explicit
  *Move it to the current canon →* action.
- **Rollback** — the previous publication is retained and can be reactivated
  from Settings.
- **Provenance** — installs are copied into the app's data with a receipt per
  publication, so the app works offline from its own cache.
