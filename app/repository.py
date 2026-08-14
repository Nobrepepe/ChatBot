"""CRUD operations for all entities. Each function opens/closes its own connection."""

import json

from .database import get_conn
from .models import (
    Character, CharacterSprite, LoreEntry, Memory, Message,
    NOTE_CATEGORIES, NOTE_CONTEXT_MODES, NOTE_LIFECYCLE_STATUSES,
    NoteChatMessage, Persona, Scene, SceneTemplate, World, WorldNote,
)


def _rows_to(cls, rows, extra=None):
    result = []
    for row in rows:
        d = dict(row)
        if extra:
            d.update(extra(row))
        result.append(cls(**d))
    return result


# ---------------------------------------------------------------- worlds

ACTIVE_PUBLICATION_KEY = "worldhub_active_publication"


def active_publication_id() -> str | None:
    """The active World Hub publication, or None in legacy mode."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT value FROM settings WHERE key=?", (ACTIVE_PUBLICATION_KEY,)
        ).fetchone()
    return row["value"] if row and row["value"] else None


def _canon_filter(alias: str = "") -> tuple[str, tuple]:
    """SQL fragment limiting canonical rows to the active content source."""
    prefix = f"{alias}." if alias else ""
    active = active_publication_id()
    if active is None:
        return f"{prefix}publication_id IS NULL", ()
    return f"{prefix}publication_id = ?", (active,)


def list_worlds() -> list[World]:
    where, params = _canon_filter()
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM worlds WHERE {where} ORDER BY name", params
        ).fetchall()
    return _rows_to(World, rows)


def get_world(world_id: int) -> World | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM worlds WHERE id=?", (world_id,)).fetchone()
    return World(**dict(row)) if row else None


def save_world(w: World) -> int:
    with get_conn() as conn:
        if w.id is None:
            cur = conn.execute(
                """INSERT INTO worlds
                   (name, genre, tone, summary, setting_description, style_guide,
                    cover_image_path, session_background_path)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (w.name, w.genre, w.tone, w.summary, w.setting_description,
                 w.style_guide, w.cover_image_path, w.session_background_path),
            )
            return cur.lastrowid
        conn.execute(
            """UPDATE worlds SET name=?, genre=?, tone=?, summary=?,
               setting_description=?, style_guide=?, cover_image_path=?,
               session_background_path=? WHERE id=?""",
            (w.name, w.genre, w.tone, w.summary, w.setting_description,
             w.style_guide, w.cover_image_path, w.session_background_path, w.id),
        )
        return w.id


def delete_world(world_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM worlds WHERE id=?", (world_id,))


# ---------------------------------------------------------------- characters

_CHAR_SELECT = """
SELECT c.*, COALESCE(ci.image_path, '') AS portrait_path
FROM characters c
LEFT JOIN character_images ci
    ON ci.character_id = c.id AND ci.expression = 'neutral'
"""


def list_characters(world_id: int) -> list[Character]:
    # A world's characters share its content source, so no extra filter
    # is needed beyond the world itself; scenes keep resolving their own
    # (possibly older-publication) rows by id.
    with get_conn() as conn:
        rows = conn.execute(
            _CHAR_SELECT + " WHERE c.world_id=? ORDER BY c.name", (world_id,)
        ).fetchall()
    return _rows_to(Character, rows)


def get_character(character_id: int) -> Character | None:
    with get_conn() as conn:
        row = conn.execute(_CHAR_SELECT + " WHERE c.id=?", (character_id,)).fetchone()
    return Character(**dict(row)) if row else None


def save_character(c: Character) -> int:
    fields = (
        c.name, c.nicknames, c.age, c.role, c.summary, c.appearance, c.personality,
        c.backstory, c.behavior_rules, c.voice_style, c.relationship_to_user,
        c.ai_instructions, c.tile_image_path,
    )
    with get_conn() as conn:
        if c.id is None:
            cur = conn.execute(
                """INSERT INTO characters
                   (world_id, name, nicknames, age, role, summary, appearance, personality,
                    backstory, behavior_rules, voice_style, relationship_to_user,
                    ai_instructions, tile_image_path)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (c.world_id, *fields),
            )
            char_id = cur.lastrowid
        else:
            conn.execute(
                """UPDATE characters SET name=?, nicknames=?, age=?, role=?, summary=?,
                   appearance=?, personality=?, backstory=?, behavior_rules=?, voice_style=?,
                   relationship_to_user=?, ai_instructions=?, tile_image_path=? WHERE id=?""",
                (*fields, c.id),
            )
            char_id = c.id
        if c.portrait_path:
            conn.execute(
                """INSERT INTO character_images (character_id, expression, image_path)
                   VALUES (?, 'neutral', ?)
                   ON CONFLICT(character_id, expression) DO UPDATE SET image_path=excluded.image_path""",
                (char_id, c.portrait_path),
            )
        return char_id


def delete_character(character_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM characters WHERE id=?", (character_id,))


# ------------------------------------------------------- character images

def list_character_images(character_id: int) -> dict[str, str]:
    """Return {expression: image_path} for a character."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT expression, image_path FROM character_images WHERE character_id=?",
            (character_id,),
        ).fetchall()
    return {r["expression"]: r["image_path"] for r in rows}


def list_character_sprites(character_id: int) -> list[CharacterSprite]:
    """Return editable custom sprites, excluding the reserved main portrait."""
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT id, character_id, name, expression AS call_sign, image_path
               FROM character_images
               WHERE character_id=? AND expression != 'neutral'
               ORDER BY id""",
            (character_id,),
        ).fetchall()
    return _rows_to(CharacterSprite, rows)


def save_character_sprite(sprite: CharacterSprite) -> int:
    with get_conn() as conn:
        if sprite.id is None:
            cur = conn.execute(
                """INSERT INTO character_images
                   (character_id, name, expression, image_path) VALUES (?,?,?,?)""",
                (sprite.character_id, sprite.name, sprite.call_sign, sprite.image_path),
            )
            return cur.lastrowid
        conn.execute(
            """UPDATE character_images SET name=?, expression=?, image_path=?
               WHERE id=? AND character_id=?""",
            (sprite.name, sprite.call_sign, sprite.image_path, sprite.id, sprite.character_id),
        )
        return sprite.id


def delete_character_sprite(sprite_id: int, character_id: int) -> None:
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM character_images WHERE id=? AND character_id=? AND expression != 'neutral'",
            (sprite_id, character_id),
        )


def set_character_image(character_id: int, expression: str, image_path: str) -> None:
    with get_conn() as conn:
        conn.execute(
            """INSERT INTO character_images (character_id, expression, image_path)
               VALUES (?,?,?)
               ON CONFLICT(character_id, expression) DO UPDATE SET image_path=excluded.image_path""",
            (character_id, expression, image_path),
        )


def delete_character_image(character_id: int, expression: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM character_images WHERE character_id=? AND expression=?",
            (character_id, expression),
        )


# ---------------------------------------------------------------- scenes

def _scene_from_row(conn, row) -> Scene:
    char_ids = [
        r["character_id"]
        for r in conn.execute(
            "SELECT character_id FROM scene_characters WHERE scene_id=?", (row["id"],)
        ).fetchall()
    ]
    d = dict(row)
    d["narrator_enabled"] = bool(d.get("narrator_enabled", 0))
    return Scene(**d, character_ids=char_ids)


def list_scenes(world_id: int) -> list[Scene]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM scenes WHERE world_id=? ORDER BY updated_at DESC", (world_id,)
        ).fetchall()
        return [_scene_from_row(conn, r) for r in rows]


def get_scene(scene_id: int) -> Scene | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM scenes WHERE id=?", (scene_id,)).fetchone()
        return _scene_from_row(conn, row) if row else None


def save_scene(s: Scene) -> int:
    with get_conn() as conn:
        if s.id is None:
            cur = conn.execute(
                """INSERT INTO scenes
                   (world_id, location_id, title, premise, tone, time_of_day,
                    relationship_status, mode, summary, narrator_enabled, persona_id,
                    publication_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (s.world_id, s.location_id, s.title, s.premise, s.tone,
                 s.time_of_day, s.relationship_status, s.mode, s.summary,
                 int(s.narrator_enabled), s.persona_id,
                 s.publication_id or active_publication_id()),
            )
            scene_id = cur.lastrowid
        else:
            conn.execute(
                """UPDATE scenes SET location_id=?, title=?, premise=?, tone=?, time_of_day=?,
                   relationship_status=?, mode=?, summary=?, narrator_enabled=?, persona_id=?,
                   updated_at=datetime('now')
                   WHERE id=?""",
                (s.location_id, s.title, s.premise, s.tone, s.time_of_day,
                 s.relationship_status, s.mode, s.summary,
                 int(s.narrator_enabled), s.persona_id, s.id),
            )
            scene_id = s.id
        conn.execute("DELETE FROM scene_characters WHERE scene_id=?", (scene_id,))
        for cid in s.character_ids:
            conn.execute(
                "INSERT INTO scene_characters (scene_id, character_id) VALUES (?,?)",
                (scene_id, cid),
            )
        return scene_id


def touch_scene(scene_id: int) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE scenes SET updated_at=datetime('now') WHERE id=?", (scene_id,))


def set_scene_summary(scene_id: int, summary: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE scenes SET summary=? WHERE id=?", (summary, scene_id))


def delete_scene(scene_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM scenes WHERE id=?", (scene_id,))


# ---------------------------------------------------------------- messages

def list_messages(scene_id: int, include_deleted: bool = False) -> list[Message]:
    q = "SELECT * FROM messages WHERE scene_id=?"
    if not include_deleted:
        q += " AND is_deleted=0"
    q += " ORDER BY id"
    with get_conn() as conn:
        rows = conn.execute(q, (scene_id,)).fetchall()
    return [
        Message(**{**dict(r), "is_deleted": bool(r["is_deleted"])}) for r in rows
    ]


def count_messages(scene_id: int) -> int:
    """Return the number of non-deleted messages in a session."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS total FROM messages WHERE scene_id=? AND is_deleted=0",
            (scene_id,),
        ).fetchone()
    return row["total"]


def add_message(scene_id: int, role: str, content: str, emotion: str = "") -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO messages (scene_id, role, content, emotion) VALUES (?,?,?,?)",
            (scene_id, role, content, emotion),
        )
        conn.execute("UPDATE scenes SET updated_at=datetime('now') WHERE id=?", (scene_id,))
        return cur.lastrowid


def update_message(message_id: int, content: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE messages SET content=? WHERE id=?", (content, message_id))


def delete_message(message_id: int) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE messages SET is_deleted=1 WHERE id=?", (message_id,))


# ---------------------------------------------------------------- memories

def list_memories(
    character_id: int,
    types: tuple[str, ...] | None = None,
    status: str = "approved",
) -> list[Memory]:
    q = "SELECT * FROM memories WHERE character_id=? AND status=?"
    params: list = [character_id, status]
    if types:
        q += f" AND type IN ({','.join('?' * len(types))})"
        params.extend(types)
    q += " ORDER BY created_at"
    with get_conn() as conn:
        rows = conn.execute(q, params).fetchall()
    return _rows_to(Memory, rows)


def save_memory(m: Memory) -> int:
    with get_conn() as conn:
        if m.id is None:
            cur = conn.execute(
                """INSERT INTO memories (character_id, type, content, source_scene_id, status)
                   VALUES (?,?,?,?,?)""",
                (m.character_id, m.type, m.content, m.source_scene_id, m.status),
            )
            return cur.lastrowid
        conn.execute(
            "UPDATE memories SET type=?, content=?, status=? WHERE id=?",
            (m.type, m.content, m.status, m.id),
        )
        return m.id


def delete_memory(memory_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM memories WHERE id=?", (memory_id,))


# ---------------------------------------------------------------- lore entries

def list_lore_entries(world_id: int) -> list[LoreEntry]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM lore_entries WHERE world_id=? ORDER BY title", (world_id,)
        ).fetchall()
    return [
        LoreEntry(**{**dict(r), "always_include": bool(r["always_include"])})
        for r in rows
    ]


def save_lore_entry(entry: LoreEntry) -> int:
    with get_conn() as conn:
        if entry.id is None:
            cur = conn.execute(
                """INSERT INTO lore_entries (world_id, title, content, keywords, always_include)
                   VALUES (?,?,?,?,?)""",
                (entry.world_id, entry.title, entry.content, entry.keywords,
                 int(entry.always_include)),
            )
            return cur.lastrowid
        conn.execute(
            """UPDATE lore_entries SET title=?, content=?, keywords=?, always_include=?
               WHERE id=?""",
            (entry.title, entry.content, entry.keywords, int(entry.always_include), entry.id),
        )
        return entry.id


def delete_lore_entry(entry_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM lore_entries WHERE id=?", (entry_id,))


# ---------------------------------------------------------------- world notes

def _note_from_row(row) -> WorldNote:
    data = dict(row)
    data["is_pinned"] = bool(data.get("is_pinned", 0))
    return WorldNote(**data)


def list_world_notes(world_id: int) -> list[WorldNote]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM world_notes
               WHERE world_id=? AND lifecycle_status='canonical'
               ORDER BY category, lower(title), id""",
            (world_id,),
        ).fetchall()
    return [_note_from_row(row) for row in rows]


def list_recent_world_notes(world_id: int) -> list[WorldNote]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM world_notes
               WHERE world_id=? AND lifecycle_status='canonical'
               ORDER BY COALESCE(last_opened_at, updated_at, created_at) DESC,
                        lower(title), id""",
            (world_id,),
        ).fetchall()
    return [_note_from_row(row) for row in rows]


def get_world_note(note_id: int) -> WorldNote | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM world_notes WHERE id=?", (note_id,)).fetchone()
    return _note_from_row(row) if row else None


def save_world_note(note: WorldNote) -> int:
    category = note.category if note.category in NOTE_CATEGORIES else "Unsorted"
    context_mode = (
        note.context_mode if note.context_mode in NOTE_CONTEXT_MODES else "relevant"
    )
    lifecycle = (
        note.lifecycle_status
        if note.lifecycle_status in NOTE_LIFECYCLE_STATUSES else "canonical"
    )
    with get_conn() as conn:
        if note.id is None:
            cur = conn.execute(
                """INSERT INTO world_notes
                   (world_id, title, content, category, is_pinned, context_mode,
                    last_opened_at, lifecycle_status, workspace_session_id,
                    proposal_message_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (
                    note.world_id, note.title, note.content, category,
                    int(note.is_pinned), context_mode, note.last_opened_at,
                    lifecycle, note.workspace_session_id, note.proposal_message_id,
                ),
            )
            note.id = cur.lastrowid
            return note.id
        conn.execute(
            """UPDATE world_notes SET title=?, content=?, category=?, is_pinned=?,
               context_mode=?, last_opened_at=?, updated_at=datetime('now')
               WHERE id=?""",
            (
                note.title, note.content, category, int(note.is_pinned),
                context_mode, note.last_opened_at, note.id,
            ),
        )
        return note.id


def touch_world_note(note_id: int) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE world_notes SET last_opened_at=datetime('now') WHERE id=?",
            (note_id,),
        )


def duplicate_world_note(note_id: int) -> WorldNote | None:
    note = get_world_note(note_id)
    if note is None:
        return None
    existing = {n.title.casefold() for n in list_world_notes(note.world_id)}
    base = (note.title.strip() or "Untitled") + " copy"
    title = base
    suffix = 2
    while title.casefold() in existing:
        title = f"{base} {suffix}"
        suffix += 1
    duplicate = WorldNote(
        world_id=note.world_id,
        title=title,
        content=note.content,
        category=note.category,
        context_mode="relevant",
    )
    save_world_note(duplicate)
    return duplicate


def delete_world_note(note_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM world_notes WHERE id=?", (note_id,))


# ------------------------------------------------------ world notes chat

def list_note_chat_messages(world_id: int) -> list[NoteChatMessage]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM world_notes_chat WHERE world_id=? ORDER BY id", (world_id,)
        ).fetchall()
    return _rows_to(NoteChatMessage, rows)


def add_note_chat_message(world_id: int, role: str, content: str) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO world_notes_chat (world_id, role, content) VALUES (?,?,?)",
            (world_id, role, content),
        )
        return cur.lastrowid


def update_note_chat_message(message_id: int, content: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE world_notes_chat SET content=? WHERE id=?",
            (content, message_id),
        )


def delete_note_chat_message(message_id: int) -> None:
    with get_conn() as conn:
        conn.execute(
            """DELETE FROM world_notes
               WHERE proposal_message_id=? AND lifecycle_status!='canonical'""",
            (message_id,),
        )
        conn.execute("DELETE FROM world_notes_chat WHERE id=?", (message_id,))


def clear_note_chat(world_id: int) -> None:
    with get_conn() as conn:
        sessions = conn.execute(
            """SELECT id FROM world_notes_workspace_sessions
               WHERE world_id=? AND cleared_at IS NULL""",
            (world_id,),
        ).fetchall()
        for session in sessions:
            conn.execute(
                """DELETE FROM world_notes
                   WHERE workspace_session_id=? AND lifecycle_status!='canonical'""",
                (session["id"],),
            )
        conn.execute("DELETE FROM world_notes_chat WHERE world_id=?", (world_id,))
        conn.execute(
            """UPDATE world_notes_workspace_sessions
               SET cleared_at=datetime('now')
               WHERE world_id=? AND cleared_at IS NULL""",
            (world_id,),
        )


def save_note_prompt_usage(
    message_id: int, entries: list[tuple[int, str, str]]
) -> None:
    """Store (note id, fingerprint, reason) entries for an outgoing message."""
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM world_note_prompt_usage WHERE message_id=?", (message_id,)
        )
        conn.executemany(
            """INSERT INTO world_note_prompt_usage
               (message_id, note_id, note_fingerprint, inclusion_reason)
               VALUES (?,?,?,?)""",
            [(message_id, note_id, fingerprint, reason)
             for note_id, fingerprint, reason in entries],
        )


def latest_note_prompt_usage(world_id: int) -> dict[int, tuple[str, str]]:
    """Return the note snapshot used by the latest completed assistant reply."""
    with get_conn() as conn:
        assistant = conn.execute(
            """SELECT id FROM world_notes_chat
               WHERE world_id=? AND role='assistant' ORDER BY id DESC LIMIT 1""",
            (world_id,),
        ).fetchone()
        if assistant is None:
            return {}
        request = conn.execute(
            """SELECT id FROM world_notes_chat
               WHERE world_id=? AND role='user' AND id < ?
               ORDER BY id DESC LIMIT 1""",
            (world_id, assistant["id"]),
        ).fetchone()
        if request is None:
            return {}
        rows = conn.execute(
            """SELECT note_id, note_fingerprint, inclusion_reason
               FROM world_note_prompt_usage WHERE message_id=?""",
            (request["id"],),
        ).fetchall()
    return {
        row["note_id"]: (row["note_fingerprint"], row["inclusion_reason"])
        for row in rows
    }


def save_note_suggestion(
    message_id: int, ordinal: int, action_type: str,
    target_note_id: int | None, payload: dict,
) -> int:
    with get_conn() as conn:
        existing = conn.execute(
            """SELECT id FROM world_note_suggestions
               WHERE message_id=? AND ordinal=?""",
            (message_id, ordinal),
        ).fetchone()
        if existing:
            return existing["id"]
        message = conn.execute(
            "SELECT world_id FROM world_notes_chat WHERE id=?", (message_id,)
        ).fetchone()
        if message is None:
            raise ValueError("Suggestion message not found")
        world_id = message["world_id"]

        if action_type == "create":
            active = conn.execute(
                """SELECT id FROM world_notes_workspace_sessions
                   WHERE world_id=? AND cleared_at IS NULL
                   ORDER BY id DESC LIMIT 1""",
                (world_id,),
            ).fetchone()
            session_id = active["id"] if active else conn.execute(
                "INSERT INTO world_notes_workspace_sessions(world_id) VALUES (?)",
                (world_id,),
            ).lastrowid
            title = str(payload.get("title", "")).strip().casefold()
            if title:
                pending = conn.execute(
                    """SELECT s.id, s.target_note_id, s.payload_json
                       FROM world_note_suggestions s
                       JOIN world_notes_chat m ON m.id=s.message_id
                       WHERE m.world_id=? AND s.status IN ('pending','rejected')
                         AND s.action_type='create'""",
                    (world_id,),
                ).fetchall()
                for existing in pending:
                    existing_payload = json.loads(existing["payload_json"])
                    if str(existing_payload.get("title", "")).strip().casefold() == title:
                        conn.execute(
                            """UPDATE world_note_suggestions
                               SET status='superseded' WHERE id=?""",
                            (existing["id"],),
                        )
                        if existing["target_note_id"] is not None:
                            conn.execute(
                                """UPDATE world_notes SET lifecycle_status='superseded'
                                   WHERE id=? AND lifecycle_status!='canonical'""",
                                (existing["target_note_id"],),
                            )
            category = payload.get("category", "Unsorted")
            if category not in NOTE_CATEGORIES:
                category = "Unsorted"
            context = payload.get("context_mode", "relevant")
            if context not in NOTE_CONTEXT_MODES:
                context = "relevant"
            target_note_id = conn.execute(
                """INSERT INTO world_notes
                   (world_id, title, content, category, is_pinned, context_mode,
                    lifecycle_status, workspace_session_id, proposal_message_id)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (
                    world_id, payload.get("title", ""), payload.get("content", ""),
                    category, int(bool(payload.get("is_pinned", False))), context,
                    "proposed", session_id, message_id,
                ),
            ).lastrowid
            payload = {**payload, "note_id": target_note_id}
        elif target_note_id is not None:
            target = conn.execute(
                """SELECT lifecycle_status FROM world_notes
                   WHERE id=? AND world_id=?""",
                (target_note_id, world_id),
            ).fetchone()
            if target is None:
                raise ValueError("Suggestion target note not found")
            if target["lifecycle_status"] != "canonical":
                conn.execute(
                    """UPDATE world_notes SET lifecycle_status='proposed',
                       proposal_message_id=? WHERE id=?""",
                    (message_id, target_note_id),
                )

        cursor = conn.execute(
            """INSERT INTO world_note_suggestions
               (message_id, ordinal, action_type, target_note_id, payload_json)
               VALUES (?,?,?,?,?)""",
            (
                message_id, ordinal, action_type, target_note_id,
                json.dumps(payload, ensure_ascii=False),
            ),
        )
        return cursor.lastrowid


def list_note_suggestions(message_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT * FROM world_note_suggestions
               WHERE message_id=? ORDER BY ordinal""",
            (message_id,),
        ).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        item["payload"] = json.loads(item.pop("payload_json"))
        result.append(item)
    return result


def set_note_suggestion_status(suggestion_id: int, status: str) -> None:
    if status not in {"pending", "approved", "rejected", "superseded"}:
        raise ValueError("Invalid suggestion status")
    with get_conn() as conn:
        suggestion = conn.execute(
            """SELECT target_note_id FROM world_note_suggestions WHERE id=?""",
            (suggestion_id,),
        ).fetchone()
        conn.execute(
            "UPDATE world_note_suggestions SET status=? WHERE id=?",
            (status, suggestion_id),
        )
        if suggestion and suggestion["target_note_id"] is not None:
            if status == "rejected":
                conn.execute(
                    """UPDATE world_notes SET lifecycle_status='rejected'
                       WHERE id=? AND lifecycle_status!='canonical'""",
                    (suggestion["target_note_id"],),
                )
            elif status == "superseded":
                conn.execute(
                    """UPDATE world_notes SET lifecycle_status='superseded'
                       WHERE id=? AND lifecycle_status!='canonical'""",
                    (suggestion["target_note_id"],),
                )


def approve_note_suggestion(
    suggestion_id: int, title: str, content: str, category: str,
    context_mode: str, is_pinned: bool,
) -> int:
    category = category if category in NOTE_CATEGORIES else "Unsorted"
    context_mode = (
        context_mode if context_mode in NOTE_CONTEXT_MODES else "relevant"
    )
    with get_conn() as conn:
        suggestion = conn.execute(
            """SELECT target_note_id FROM world_note_suggestions WHERE id=?""",
            (suggestion_id,),
        ).fetchone()
        if suggestion is None or suggestion["target_note_id"] is None:
            raise ValueError("The proposal no longer has a note")
        note_id = suggestion["target_note_id"]
        conn.execute(
            """UPDATE world_notes SET title=?, content=?, category=?, is_pinned=?,
               context_mode=?, lifecycle_status='canonical',
               workspace_session_id=NULL, proposal_message_id=NULL,
               updated_at=datetime('now') WHERE id=?""",
            (
                title, content, category, int(is_pinned), context_mode, note_id,
            ),
        )
        conn.execute(
            "UPDATE world_note_suggestions SET status='approved' WHERE id=?",
            (suggestion_id,),
        )
    return note_id


def clear_note_suggestions(message_id: int) -> None:
    with get_conn() as conn:
        conn.execute(
            """DELETE FROM world_notes
               WHERE proposal_message_id=? AND lifecycle_status!='canonical'""",
            (message_id,),
        )
        conn.execute(
            "DELETE FROM world_note_suggestions WHERE message_id=?", (message_id,)
        )


def list_workspace_proposal_ledger(world_id: int) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT s.*, n.lifecycle_status, n.title AS note_title,
                      n.content AS note_content, n.category AS note_category,
                      n.context_mode AS note_context_mode,
                      n.is_pinned AS note_is_pinned
               FROM world_note_suggestions s
               JOIN world_notes_chat m ON m.id=s.message_id
               LEFT JOIN world_notes n ON n.id=s.target_note_id
               WHERE m.world_id=?
                 AND s.status IN ('pending','rejected','superseded')
                 AND s.id=(
                     SELECT MAX(s2.id) FROM world_note_suggestions s2
                     WHERE s2.target_note_id=s.target_note_id
                       AND s2.status IN ('pending','rejected','superseded')
                 )
               ORDER BY s.id""",
            (world_id,),
        ).fetchall()
    result = []
    for row in rows:
        item = dict(row)
        item["payload"] = json.loads(item.pop("payload_json"))
        result.append(item)
    return result


def list_pending_note_suggestions(world_id: int) -> list[dict]:
    return [
        item for item in list_workspace_proposal_ledger(world_id)
        if item["status"] == "pending"
    ]


def list_workspace_note_ids(world_id: int) -> set[int]:
    with get_conn() as conn:
        rows = conn.execute(
            """SELECT id FROM world_notes
               WHERE world_id=? AND lifecycle_status IN
                   ('canonical','proposed','rejected')""",
            (world_id,),
        ).fetchall()
    return {row["id"] for row in rows}


# ---------------------------------------------------------------- personas

def list_personas() -> list[Persona]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM personas ORDER BY name").fetchall()
    return _rows_to(Persona, rows)


def get_persona(persona_id: int) -> Persona | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM personas WHERE id=?", (persona_id,)).fetchone()
    return Persona(**dict(row)) if row else None


def save_persona(p: Persona) -> int:
    with get_conn() as conn:
        if p.id is None:
            cur = conn.execute(
                "INSERT INTO personas (name, description) VALUES (?,?)",
                (p.name, p.description),
            )
            return cur.lastrowid
        conn.execute(
            "UPDATE personas SET name=?, description=? WHERE id=?",
            (p.name, p.description, p.id),
        )
        return p.id


def delete_persona(persona_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM personas WHERE id=?", (persona_id,))


# ---------------------------------------------------------------- scene templates

def _template_from_row(row) -> SceneTemplate:
    d = dict(row)
    d["narrator_enabled"] = bool(d["narrator_enabled"])
    d["character_ids"] = [int(c) for c in d["character_ids"].split(",") if c]
    return SceneTemplate(**d)


def list_scene_templates(world_id: int) -> list[SceneTemplate]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM scene_templates WHERE world_id=? ORDER BY name", (world_id,)
        ).fetchall()
    return [_template_from_row(r) for r in rows]


def save_scene_template(t: SceneTemplate) -> int:
    char_ids = ",".join(str(c) for c in t.character_ids)
    with get_conn() as conn:
        if t.id is None:
            cur = conn.execute(
                """INSERT INTO scene_templates
                   (world_id, name, premise, tone, time_of_day, relationship_status,
                    mode, narrator_enabled, location_id, persona_id, character_ids)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (t.world_id, t.name, t.premise, t.tone, t.time_of_day,
                 t.relationship_status, t.mode, int(t.narrator_enabled),
                 t.location_id, t.persona_id, char_ids),
            )
            return cur.lastrowid
        conn.execute(
            """UPDATE scene_templates SET name=?, premise=?, tone=?, time_of_day=?,
               relationship_status=?, mode=?, narrator_enabled=?, location_id=?,
               persona_id=?, character_ids=? WHERE id=?""",
            (t.name, t.premise, t.tone, t.time_of_day, t.relationship_status,
             t.mode, int(t.narrator_enabled), t.location_id, t.persona_id,
             char_ids, t.id),
        )
        return t.id


def delete_scene_template(template_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM scene_templates WHERE id=?", (template_id,))


# ---------------------------------------------------------------- settings

def get_settings() -> dict[str, str]:
    with get_conn() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    return {r["key"]: r["value"] for r in rows}


def save_settings(values: dict[str, str]) -> None:
    with get_conn() as conn:
        for key, value in values.items():
            conn.execute(
                """INSERT INTO settings (key, value) VALUES (?,?)
                   ON CONFLICT(key) DO UPDATE SET value=excluded.value""",
                (key, value),
            )


def save_setting(key: str, value: str) -> None:
    save_settings({key: value})
