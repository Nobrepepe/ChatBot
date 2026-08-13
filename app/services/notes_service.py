"""Pure note-workspace helpers: filtering, context selection, and AI actions."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass

from ..models import NOTE_CATEGORIES, NOTE_CONTEXT_MODES, NoteChatMessage, WorldNote

_WORDS = re.compile(r"[^\W_]+", re.UNICODE)
_ACTION_BLOCK = re.compile(
    r"(?:"
    r"```note_action\s*\n(?P<direct>.*?)\s*\n```"
    r"|"
    r"`note_action`\s*\n?\s*```json\s*\n(?P<labelled>.*?)\s*\n```"
    r"|"
    r"```json\s*\n(?P<generic>.*?)\s*\n```"
    r"|"
    r"(?:^|\n)(?P<bare>\[\s*\{.*\}\s*\])\s*$"
    r"|"
    r"(?:^|\n)(?P<bare_object>\{\s*\"type\"\s*:\s*"
    r"\"(?:open|create|append|replace)\".*\})\s*$"
    r")",
    re.IGNORECASE | re.DOTALL,
)
_PROTECTED_MARKDOWN = re.compile(
    r"(```.*?```|`[^`\n]*`|\[[^\]]+\]\([^)]+\))", re.DOTALL
)
_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
    "had", "has", "have", "he", "her", "his", "i", "in", "is", "it", "its",
    "me", "my", "of", "on", "or", "our", "she", "that", "the", "their", "them",
    "they", "this", "to", "was", "we", "were", "what", "when", "where", "who",
    "will", "with", "you", "your",
}


@dataclass(frozen=True)
class SelectedNote:
    note: WorldNote
    reason: str


@dataclass(frozen=True)
class NoteAction:
    ordinal: int
    action_type: str
    target_note_id: int | None
    payload: dict


def note_fingerprint(note: WorldNote) -> str:
    raw = "\0".join(
        (
            note.title, note.content, note.category, note.context_mode,
            "1" if note.is_pinned else "0",
        )
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _tokens(value: str) -> set[str]:
    return {
        token.casefold() for token in _WORDS.findall(value)
        if len(token) >= 3 and token.casefold() not in _STOPWORDS
    }


def _exact_title_match(note: WorldNote, haystack: str) -> bool:
    title = note.title.strip()
    return len(title) >= 3 and bool(
        re.search(rf"(?<!\w){re.escape(title)}(?!\w)", haystack, re.IGNORECASE)
    )


def select_notes_for_context(
    notes: list[WorldNote],
    current_message: str,
    history: list[NoteChatMessage],
    active_note_id: int | None = None,
    recent_messages: int = 6,
) -> list[SelectedNote]:
    """Select notes conservatively while respecting explicit exclusion."""
    recent_text = "\n".join(m.content for m in history[-recent_messages:])
    haystack = f"{current_message}\n{recent_text}".strip()
    query_tokens = _tokens(haystack)
    selected: dict[int, SelectedNote] = {}
    for note in notes:
        if note.id is None or note.context_mode == "excluded":
            continue
        if note.context_mode == "always":
            selected[note.id] = SelectedNote(note, "always included")
        elif note.id == active_note_id:
            selected[note.id] = SelectedNote(note, "active note")
        elif haystack and _exact_title_match(note, haystack):
            selected[note.id] = SelectedNote(note, "title referenced")
        elif len(query_tokens) >= 2:
            title_overlap = query_tokens & _tokens(note.title)
            content_overlap = query_tokens & _tokens(note.content)
            if title_overlap or len(content_overlap) >= 2:
                selected[note.id] = SelectedNote(note, "matched current discussion")
    reason_order = {
        "always included": 0, "title referenced": 1,
        "active note": 2, "matched current discussion": 3,
    }
    return sorted(
        selected.values(),
        key=lambda item: (
            reason_order.get(item.reason, 9),
            NOTE_CATEGORIES.index(item.note.category)
            if item.note.category in NOTE_CATEGORIES else len(NOTE_CATEGORIES),
            item.note.title.casefold(), item.note.id,
        ),
    )


def filter_notes(
    notes: list[WorldNote], query: str = "", selected_filter: str = "all"
) -> list[WorldNote]:
    result = list(notes)
    if selected_filter == "pinned":
        result = [note for note in result if note.is_pinned]
    elif selected_filter == "recent":
        result.sort(
            key=lambda note: note.last_opened_at or note.updated_at or note.created_at,
            reverse=True,
        )
    if query.strip():
        needle = query.casefold().strip()
        result = [
            note for note in result
            if needle in note.title.casefold()
            or needle in note.content.casefold()
            or needle in note.category.casefold()
        ]
    return result


def parse_note_actions(text: str, valid_note_ids: set[int]) -> tuple[str, list[NoteAction]]:
    """Extract valid portable note_action blocks; invalid blocks remain visible."""
    actions: list[NoteAction] = []
    parts: list[str] = []
    cursor = 0
    ordinal = 0
    for match in _ACTION_BLOCK.finditer(text):
        parts.append(text[cursor:match.start()])
        try:
            decoded = json.loads(
                match.group("direct")
                or match.group("labelled")
                or match.group("generic")
                or match.group("bare")
                or match.group("bare_object")
            )
            payloads = decoded if isinstance(decoded, list) else [decoded]
            if not payloads or not all(isinstance(payload, dict) for payload in payloads):
                raise ValueError("invalid action payload")
            parsed = []
            for payload in payloads:
                payload = dict(payload)
                action_type = str(payload.get("type", "")).casefold()
                if action_type not in {"open", "create", "append", "replace"}:
                    raise ValueError("unsupported action")
                target = payload.get("note_id")
                if action_type != "create":
                    if not isinstance(target, int) or target not in valid_note_ids:
                        raise ValueError("invalid target")
                else:
                    target = None
                    category = payload.get("category", "Unsorted")
                    if category not in NOTE_CATEGORIES:
                        category = "Unsorted"
                    payload["category"] = category
                    context_aliases = {
                        "always": "always",
                        "always included": "always",
                        "relevant": "relevant",
                        "character": "relevant",
                        "contextual": "relevant",
                        "included when relevant": "relevant",
                        "excluded": "excluded",
                        "never": "excluded",
                    }
                    context = context_aliases.get(
                        str(payload.get("context_mode", "relevant")).casefold(),
                        "relevant",
                    )
                    payload["context_mode"] = context
                if action_type in {"create", "append", "replace"} and not isinstance(
                    payload.get("content"), str
                ):
                    raise ValueError("missing content")
                parsed.append((action_type, target, payload))
            for action_type, target, payload in parsed:
                actions.append(NoteAction(ordinal, action_type, target, payload))
                ordinal += 1
        except (TypeError, ValueError, json.JSONDecodeError):
            parts.append(match.group(0))
        cursor = match.end()
    parts.append(text[cursor:])
    return "".join(parts).strip(), actions


def link_note_references(text: str, notes: list[WorldNote]) -> str:
    """Add internal Markdown links only for unique, sufficiently specific titles."""
    by_title: dict[str, list[WorldNote]] = {}
    for note in notes:
        title = note.title.strip()
        if note.id is not None and len(title) >= 3:
            by_title.setdefault(title.casefold(), []).append(note)
    unique = [items[0] for items in by_title.values() if len(items) == 1]
    unique.sort(key=lambda note: len(note.title), reverse=True)
    if not unique:
        return text
    pattern = re.compile(
        r"(?<!\w)(" + "|".join(re.escape(note.title) for note in unique) + r")(?!\w)",
        re.IGNORECASE,
    )
    ids = {note.title.casefold(): note.id for note in unique}

    def link_segment(segment: str) -> str:
        return pattern.sub(
            lambda match: f"[{match.group(0)}](app-note://"
                          f"{ids[match.group(0).casefold()]})",
            segment,
        )

    parts = _PROTECTED_MARKDOWN.split(text)
    return "".join(
        part if index % 2 else link_segment(part)
        for index, part in enumerate(parts)
    )
