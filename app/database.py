"""SQLite connection management and schema creation."""

import json
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
ASSETS_DIR = PROJECT_ROOT / "assets"
DB_PATH = DATA_DIR / "chatbot.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS worlds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    genre TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    setting_description TEXT NOT NULL DEFAULT '',
    style_guide TEXT NOT NULL DEFAULT '',
    cover_image_path TEXT NOT NULL DEFAULT '',
    session_background_path TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    background_path TEXT NOT NULL DEFAULT '',
    mood_tags TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    nicknames TEXT NOT NULL DEFAULT '',
    age TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    appearance TEXT NOT NULL DEFAULT '',
    personality TEXT NOT NULL DEFAULT '',
    backstory TEXT NOT NULL DEFAULT '',
    behavior_rules TEXT NOT NULL DEFAULT '',
    voice_style TEXT NOT NULL DEFAULT '',
    relationship_to_user TEXT NOT NULL DEFAULT '',
    ai_instructions TEXT NOT NULL DEFAULT '',
    tile_image_path TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per image; expression is 'neutral' for now, future-proofs sprites.
CREATE TABLE IF NOT EXISTS character_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    expression TEXT NOT NULL DEFAULT 'neutral',
    name TEXT NOT NULL DEFAULT '',
    image_path TEXT NOT NULL,
    UNIQUE(character_id, expression)
);

CREATE TABLE IF NOT EXISTS scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT '',
    premise TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT '',
    time_of_day TEXT NOT NULL DEFAULT '',
    relationship_status TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'roleplay',
    summary TEXT NOT NULL DEFAULT '',
    narrator_enabled INTEGER NOT NULL DEFAULT 0,
    persona_id INTEGER REFERENCES personas(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Join table so multi-character scenes remain possible later.
CREATE TABLE IF NOT EXISTS scene_characters (
    scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    PRIMARY KEY (scene_id, character_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
    role TEXT NOT NULL,               -- user | character | narrator | system-note
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_deleted INTEGER NOT NULL DEFAULT 0,
    emotion TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS lore_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    keywords TEXT NOT NULL DEFAULT '',        -- comma-separated match terms
    always_include INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS world_notes_workspace_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    cleared_at TEXT
);

-- Private worldbuilding notes. Shown only in the notes workspace; never
-- injected into scene prompts.
CREATE TABLE IF NOT EXISTS world_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Unsorted',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    context_mode TEXT NOT NULL DEFAULT 'relevant',
    last_opened_at TEXT,
    lifecycle_status TEXT NOT NULL DEFAULT 'canonical',
    workspace_session_id INTEGER
        REFERENCES world_notes_workspace_sessions(id) ON DELETE SET NULL,
    proposal_message_id INTEGER REFERENCES world_notes_chat(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS world_notes_chat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    role TEXT NOT NULL,               -- user | assistant
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS world_note_prompt_usage (
    message_id INTEGER NOT NULL REFERENCES world_notes_chat(id) ON DELETE CASCADE,
    note_id INTEGER NOT NULL REFERENCES world_notes(id) ON DELETE CASCADE,
    note_fingerprint TEXT NOT NULL,
    inclusion_reason TEXT NOT NULL,
    PRIMARY KEY (message_id, note_id)
);

CREATE TABLE IF NOT EXISTS world_note_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES world_notes_chat(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    target_note_id INTEGER REFERENCES world_notes(id) ON DELETE SET NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(message_id, ordinal)
);

CREATE TABLE IF NOT EXISTS personas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS scene_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    premise TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT '',
    time_of_day TEXT NOT NULL DEFAULT '',
    relationship_status TEXT NOT NULL DEFAULT '',
    mode TEXT NOT NULL DEFAULT 'roleplay',
    narrator_enabled INTEGER NOT NULL DEFAULT 0,
    location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    persona_id INTEGER REFERENCES personas(id) ON DELETE SET NULL,
    character_ids TEXT NOT NULL DEFAULT ''    -- comma-separated character ids
);

CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'canon',   -- canon | relationship | session
    content TEXT NOT NULL,
    source_scene_id INTEGER REFERENCES scenes(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'approved',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

DEFAULT_SETTINGS = {
    "base_url": "http://localhost:11434/v1",
    "api_key": "",
    "model": "",
    "temperature": "0.8",
    "top_p": "0.95",
    "max_tokens": "1024",
    "streaming": "1",
    "history_limit": "30",
    "display_mode": "chat",     # chat | vn
    "dialog_theme": "midnight",
    "system_prompt": "",
}

# Columns added after the initial release; applied to existing databases.
_MIGRATIONS: dict[str, dict[str, str]] = {
    "characters": {"tile_image_path": "TEXT NOT NULL DEFAULT ''"},
    "worlds": {
        "cover_image_path": "TEXT NOT NULL DEFAULT ''",
        "session_background_path": "TEXT NOT NULL DEFAULT ''",
    },
    "character_images": {"name": "TEXT NOT NULL DEFAULT ''"},
    "messages": {"emotion": "TEXT NOT NULL DEFAULT ''"},
    "scenes": {
        "narrator_enabled": "INTEGER NOT NULL DEFAULT 0",
        "persona_id": "INTEGER REFERENCES personas(id) ON DELETE SET NULL",
    },
    "world_notes": {
        "category": "TEXT NOT NULL DEFAULT 'Unsorted'",
        "is_pinned": "INTEGER NOT NULL DEFAULT 0",
        # Existing notes were all inserted into every notes-workspace prompt.
        "context_mode": "TEXT NOT NULL DEFAULT 'always'",
        "last_opened_at": "TEXT",
        "lifecycle_status": "TEXT NOT NULL DEFAULT 'canonical'",
        "workspace_session_id":
            "INTEGER REFERENCES world_notes_workspace_sessions(id) ON DELETE SET NULL",
        "proposal_message_id":
            "INTEGER REFERENCES world_notes_chat(id) ON DELETE SET NULL",
    },
}


def _migrate(conn: sqlite3.Connection) -> None:
    for table, columns in _MIGRATIONS.items():
        existing = {
            row["name"] for row in conn.execute(f"PRAGMA table_info({table})")
        }
        for column, ddl in columns.items():
            if column not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
    # Existing expression rows become editable custom sprites without losing data.
    conn.execute(
        """UPDATE character_images
           SET name = CASE
               WHEN expression = 'neutral' THEN 'Main portrait'
               ELSE upper(substr(expression, 1, 1)) || substr(expression, 2)
           END
           WHERE name = ''"""
    )
    # The first overhaul wrote generated memory proposals as "suggested" while
    # the review UI and repository contract use "pending".
    conn.execute("UPDATE memories SET status='pending' WHERE status='suggested'")
    # Consolidate the original broad note taxonomy into the smaller workspace
    # taxonomy without losing or orphaning any notes.
    conn.execute(
        """UPDATE world_notes
           SET category = CASE
               WHEN category = 'Characters' THEN 'Characters'
               WHEN category IN ('Locations', 'Factions', 'Lore', 'Timeline', 'Items')
                   THEN 'Setting'
               WHEN category = 'Plot Threads' THEN 'Plot'
               WHEN category IN ('Setting', 'Plot', 'Unsorted') THEN category
               ELSE 'Unsorted'
           END"""
    )
    # Give pre-lifecycle pending create proposals real provisional note IDs.
    legacy = conn.execute(
        """SELECT s.id AS suggestion_id, s.message_id, s.payload_json, s.status,
                  m.world_id
           FROM world_note_suggestions s
           JOIN world_notes_chat m ON m.id=s.message_id
           WHERE s.status IN ('pending','rejected','superseded')
             AND s.action_type='create'
             AND s.target_note_id IS NULL"""
    ).fetchall()
    sessions: dict[int, int] = {}
    for row in legacy:
        world_id = row["world_id"]
        if world_id not in sessions:
            active = conn.execute(
                """SELECT id FROM world_notes_workspace_sessions
                   WHERE world_id=? AND cleared_at IS NULL ORDER BY id DESC LIMIT 1""",
                (world_id,),
            ).fetchone()
            if active:
                sessions[world_id] = active["id"]
            else:
                sessions[world_id] = conn.execute(
                    "INSERT INTO world_notes_workspace_sessions(world_id) VALUES (?)",
                    (world_id,),
                ).lastrowid
        try:
            payload = json.loads(row["payload_json"])
        except (TypeError, json.JSONDecodeError):
            continue
        category = payload.get("category", "Unsorted")
        if category not in {"Characters", "Setting", "Plot", "Unsorted"}:
            category = "Unsorted"
        context = payload.get("context_mode", "relevant")
        if context not in {"always", "relevant", "excluded"}:
            context = "relevant"
        note_id = conn.execute(
            """INSERT INTO world_notes
               (world_id, title, content, category, is_pinned, context_mode,
                lifecycle_status, workspace_session_id, proposal_message_id)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                world_id, payload.get("title", ""), payload.get("content", ""),
                category, int(bool(payload.get("is_pinned", False))), context,
                "proposed" if row["status"] == "pending" else row["status"],
                sessions[world_id], row["message_id"],
            ),
        ).lastrowid
        conn.execute(
            "UPDATE world_note_suggestions SET target_note_id=? WHERE id=?",
            (note_id, row["suggestion_id"]),
        )


def get_conn() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    (ASSETS_DIR / "worlds").mkdir(parents=True, exist_ok=True)
    conn = get_conn()
    try:
        conn.executescript(_SCHEMA)
        _migrate(conn)
        for key, value in DEFAULT_SETTINGS.items():
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (key, value),
            )
        conn.commit()
    finally:
        conn.close()
