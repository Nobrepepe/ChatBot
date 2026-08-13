# Character Chat

A desktop app for chatting with your fictional characters in a visual-novel-style
interface, powered by local AI models. Built with Python and [Flet](https://flet.dev).

Create worlds, give them characters with prompt-ready profiles, set up scenes
(premise, tone, relationship state, mode), and chat. Approved canon and relationship
memories are injected into every prompt, so characters develop over time
instead of starting fresh each session.

## Features

- **Worlds**: wide cover and session images, setting descriptions, style guides,
  and a **lorebook** - modular lore entries injected into prompts only
  when their keywords appear in the scene premise or recent messages
- **Characters**: structured profile (personality, backstory, behavior rules,
  voice, relationship to you, direct AI instructions), a portrait image, and
  **custom sprites** for any emotion, pose, or action - give each image a name
  and bracket call sign (such as `[sad]` or `[sword-attack]`) and the AI swaps
  the portrait when it uses that call sign
- **Scenes**: each chat starts from a setup - characters (one or several),
  premise, tone, time of day, relationship status, your **persona**,
  an optional **narrator**, and a mode:
  - *Roleplay* - interact inside the world
  - *Interview* - question the character as a writer
  - *Author assistant* - discuss the character with a writing assistant
- **Scene templates**: save a setup and start future scenes from it
- **Multi-character scenes**: several characters reply in labeled dialogue
  with distinct voices; the active speaker's portrait is highlighted
- **Two display modes**: rolling chat history, or **visual novel mode** showing
  the latest message over the scene art plus a backlog viewer
- **Response controls**: regenerate, edit, delete, save any message as a memory,
  or use **Impersonate** to draft the user persona's next action and dialogue;
  **Continue** lets the AI finish a reply from where it stops - trim away the
  parts you don't like in the editor, hit *Save & Continue*, and the AI writes
  the rest without regenerating what you kept
- **Memory / canon system**: canon facts and relationship state per character,
  injected into every prompt; **automatic memory suggestions** after a scene
  with an approve / edit / reject review, plus scene summaries that cover
  history falling outside the context window
- **Worldbuilding notes**: a private notes tab per world - unlike the lorebook,
  notes are never injected into character scene prompts. The **AI workspace**
  provides compact categorized browsing, search, Recent/Pinned filters, one
  active editor, focus mode, and a `Ctrl+K` / `Cmd+K` note switcher. Each note
  can be always included, selected when relevant, or excluded from the writing
  assistant; proposed AI edits are previewed and require approval
- **Chat export**: save any scene as a Markdown transcript in `data/exports/`
- **Prompt debug panel**: see every prompt section (including which lore
  entries matched and why) and the exact payload sent to the model
- **Provider**: any OpenAI-compatible endpoint - Ollama, LM Studio,
  llama.cpp server, KoboldCpp...

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python main.py
```

## Connecting a local model

Open **Settings** (gear icon on the home screen) and set:

| Server    | Base URL                     |
|-----------|------------------------------|
| Ollama    | `http://localhost:11434/v1`  |
| LM Studio | `http://localhost:1234/v1`   |
| llama.cpp | `http://localhost:8080/v1`   |

Click **Test connection** to list the models available on the server, pick one,
and save. Temperature, top-p, max tokens, streaming, and the history window
(how many recent messages are sent per request) are configurable there too.
You can also set a global system prompt; it is sent before the automatically
generated character, world, scene, lore, and memory context.

No model running? Try the bundled mock server to explore the app:

```bash
.venv/bin/python scripts/mock_server.py          # serves http://localhost:8111/v1
```

## Suggested workflow

1. Create a **world**, fill in the setting description and style guide
2. Add a session backdrop and **lorebook** entries with trigger keywords
3. Create a **character**, fill in the profile sections, and add custom sprites
   with their AI call signs if you have them
4. Optionally define a **persona** (home screen) for who you are in scenes
5. Start a **scene** from the world's Scenes tab; save it as a template if you
   will reuse the setup
6. Chat. When something important happens, use *Save as memory*, or run
   *Suggest memories* afterwards and review the proposals
7. Use *Summarize scene* before long chats outgrow the history window
8. Check the **prompt debug** panel whenever the character acts wrong

## Data & assets

- Everything is stored locally in `data/chatbot.db` (SQLite)
- Imported images are copied into `assets/worlds/<world>/...`; the database
  stores only paths
- `data/`, `storage/`, and `assets/worlds/` are intentionally ignored by Git,
  so chats, notes, settings, API keys, and personal artwork stay on your machine
- The app creates its local data and world-asset directories automatically on
  first launch
- The display and body typefaces (Newsreader, IBM Plex Sans) are bundled in
  `assets/fonts/`, so the UI needs no network access to render correctly

## Project layout

```text
main.py                  Flet entry point + routing
app/
  database.py            SQLite schema and connection
  models.py              dataclasses for all entities
  repository.py          CRUD
  prompt_builder.py      assembles prompts section by section
  providers/             AIProvider base + OpenAI-compatible implementation
  services/              chat orchestration, image asset importing
  ui/                    one module per screen + router
  ui/theme.py            design tokens and responsive control factories
scripts/mock_server.py   fake OpenAI-compatible endpoint for testing
```
