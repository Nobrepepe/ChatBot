"""World-note explorer, editor, and private writing assistant."""

from __future__ import annotations

import flet as ft

from .. import repository as repo
from ..models import NOTE_CATEGORIES, WorldNote
from ..prompt_builder import build_notes_chat_prompt
from ..providers.base import ProviderError
from ..providers.openai_compat import get_provider
from ..services.notes_service import (
    filter_notes, link_note_references, note_fingerprint, parse_note_actions,
    select_notes_for_context,
)
from . import theme as th

CONTEXT_OPTIONS = [
    ("always", "Always included"),
    ("relevant", "When relevant"),
    ("excluded", "Excluded from chat"),
]


class NotesController:
    """Shared note explorer/editor state used by both notes surfaces."""

    def __init__(self, page: ft.Page, world_id: int, compact_editor: bool = False):
        self.page = page
        self.world_id = world_id
        self.compact_editor = compact_editor
        self.notes: list[WorldNote] = []
        self.selected_id: int | None = None
        self.query = ""
        self.filter = "all"
        self.collapsed: set[str] = set()
        self.drafts: dict[int, dict] = {}
        self.editor_collapsed = False
        self.on_editor_toggle = None
        self.browser = ft.ListView(expand=True, spacing=0, padding=0)
        self.editor = ft.Container(expand=True)
        self.context_summary = th.caption("No notes will be sent with the next request.")
        self.search = th.UnderlinedField("Search notes", "", hint="Search title or text…")
        self.search.text_field.on_change = self._search
        self.reload()

    def current(self) -> WorldNote | None:
        return next((n for n in self.notes if n.id == self.selected_id), None)

    def reload(self, select_id=None):
        self.notes = repo.list_world_notes(self.world_id)
        if select_id is not None:
            self.selected_id = select_id
        if self.selected_id and not any(n.id == self.selected_id for n in self.notes):
            self.selected_id = None
        self.render_browser()
        self.render_editor()

    def _search(self, event):
        self.query = event.control.value or ""
        self.render_browser()

    def set_filter(self, value):
        self.filter = value.casefold()
        self.render_browser()

    def select(self, note_id: int):
        self.selected_id = note_id
        self.editor_collapsed = False
        repo.touch_world_note(note_id)
        self.render_browser()
        self.render_editor()

    def _draft(self, note: WorldNote) -> dict:
        if note.id not in self.drafts:
            self.drafts[note.id] = {
                "title": note.title, "content": note.content,
                "category": note.category, "context_mode": note.context_mode,
                "is_pinned": note.is_pinned, "dirty": False,
            }
        return self.drafts[note.id]

    def _preview(self, note: WorldNote) -> str:
        draft = self.drafts.get(note.id)
        text = (draft or {}).get("content", note.content).replace("\n", " ").strip()
        return text or "Empty note"

    def toggle_category(self, category):
        if category in self.collapsed:
            self.collapsed.remove(category)
        else:
            self.collapsed.add(category)
        self.render_browser()

    def toggle_pin(self, note: WorldNote):
        draft = self._draft(note)
        draft["is_pinned"] = not draft["is_pinned"]
        draft["dirty"] = True
        self.render_browser(); self.render_editor()

    def render_browser(self):
        self.browser.controls.clear()
        items = filter_notes(self.notes, self.query, self.filter)
        grouped = {category: [] for category in NOTE_CATEGORIES}
        for note in items:
            grouped.setdefault(note.category, []).append(note)
        for category in NOTE_CATEGORIES:
            category_notes = grouped.get(category, [])
            if not category_notes and (self.query or self.filter != "all"):
                continue
            closed = category in self.collapsed
            heading = ft.Container(
                ft.Row([th.eyebrow(("▸ " if closed else "▾ ") + category),
                        ft.Container(expand=True), th.caption(str(len(category_notes)))], spacing=8),
                padding=ft.padding.only(top=14, bottom=8),
                on_click=lambda e, c=category: self.toggle_category(c),
                tooltip=f"{'Expand' if closed else 'Collapse'} {category}",
            )
            self.browser.controls.append(heading)
            if closed:
                continue
            for index, note in enumerate(category_notes):
                draft = self.drafts.get(note.id, {})
                selected = note.id == self.selected_id
                flags = []
                if draft.get("is_pinned", note.is_pinned): flags.append("Pinned")
                flags.append({"always":"Always in context", "relevant":"Relevant context",
                              "excluded":"Excluded"}.get(draft.get("context_mode", note.context_mode), "Relevant"))
                if draft.get("dirty"): flags.append("Unsaved")
                title = draft.get("title", note.title) or "Untitled"
                row = ft.Container(
                    ft.Row([
                        ft.Column([th.display(title, 19, th.TEXT_1 if selected else th.TEXT_DIM),
                                   th.caption(self._preview(note), max_lines=1, overflow=ft.TextOverflow.ELLIPSIS),
                                   th.mono_caption(" · ".join(flags))], spacing=2, expand=True),
                        th.secondary_action("Pin" if not draft.get("is_pinned", note.is_pinned) else "Unpin",
                                            lambda e, n=note: self.toggle_pin(n)),
                    ], spacing=12),
                    padding=ft.padding.symmetric(vertical=9),
                    bgcolor=ft.Colors.with_opacity(.055, th.ACCENT) if selected else ft.Colors.TRANSPARENT,
                    border=ft.border.only(bottom=ft.BorderSide(1, th.LINE)),
                    on_click=lambda e, nid=note.id: self.select(nid),
                    tooltip=f"Open note {title}",
                )
                self.browser.controls.append(row)
        if not items:
            message = "No notes match this search."
            if self.filter == "pinned": message = "No pinned notes yet."
            elif not self.notes: message = "Create your first note for this world."
            self.browser.controls.append(ft.Container(th.body(message), padding=ft.padding.only(top=24)))
        if self.browser.page: self.browser.update()

    def _status_text(self, note: WorldNote, dirty: bool) -> str:
        if dirty: return "Unsaved — the assistant still sees the saved version"
        latest = repo.latest_note_prompt_usage(self.world_id)
        if note.id in latest:
            fingerprint, _ = latest[note.id]
            if fingerprint == note_fingerprint(note):
                return "Saved · this version was used in the latest response"
            return "Saved · updated content will be included in your next message"
        return "Saved · available to the next message when its context setting permits"

    def _editor_fields(self, note: WorldNote, focus=False):
        draft = self._draft(note)
        title = th.UnderlinedField("Title", draft["title"])
        content = th.UnderlinedField("Note", draft["content"], multiline=True,
                                     lines=14 if focus else (8 if self.compact_editor else 12))
        status = th.caption(self._status_text(note, draft["dirty"]))

        def changed(_=None):
            draft["title"], draft["content"] = title.value, content.value
            draft["dirty"] = True
            status.value = self._status_text(note, True)
            if status.page: status.update()
            self.render_browser()

        title.text_field.on_change = changed
        content.text_field.on_change = changed

        def choose_category(value):
            draft["category"] = value; draft["dirty"] = True
            status.value = self._status_text(note, True)
            if status.page: status.update()

        def choose_context(value):
            draft["context_mode"] = value; draft["dirty"] = True
            status.value = self._status_text(note, True)
            if status.page: status.update()

        def save(_=None):
            changed()
            try:
                note.title, note.content = draft["title"].strip(), draft["content"]
                note.category, note.context_mode = draft["category"], draft["context_mode"]
                note.is_pinned = bool(draft["is_pinned"])
                repo.save_world_note(note)
            except Exception as exc:
                status.value = "Save failed — your draft is preserved"
                if status.page: status.update()
                th.snack(self.page, f"Could not save note: {exc}", True)
                return
            draft["dirty"] = False
            self.drafts.pop(note.id, None)
            self.reload(note.id)

        controls = ft.Column([
            ft.Row([th.eyebrow("Active note"), ft.Container(expand=True), status]),
            ft.Container(height=8), title, ft.Container(height=10), content,
            ft.Container(height=12),
            ft.Row([
                th.select_row("Category", draft["category"], [(x, x) for x in NOTE_CATEGORIES], choose_category),
                ft.Container(width=28),
                th.select_row("Assistant context", draft["context_mode"], CONTEXT_OPTIONS, choose_context),
            ], vertical_alignment=ft.CrossAxisAlignment.START),
            ft.Container(height=12),
            ft.Row([
                th.text_action("Save note →", save, size=27), ft.Container(expand=True),
                th.secondary_action("Unpin" if draft["is_pinned"] else "Pin", lambda e: self.toggle_pin(note)),
                th.secondary_action("Focus", lambda e: self.focus_mode(note), tooltip="Open focus editor"),
                th.secondary_action("Duplicate", lambda e: self.duplicate(note)),
                th.destructive_action("Delete", lambda e: self.delete(note)),
            ], spacing=20),
        ], spacing=0, expand=True, scroll=ft.ScrollMode.AUTO)
        return controls

    def render_editor(self):
        note = self.current()
        if self.editor_collapsed and note:
            self.editor.content = ft.Row([
                th.display(self._draft(note)["title"] or "Untitled", 20), ft.Container(expand=True),
                th.secondary_action("Expand editor", lambda e: self.toggle_editor(), tooltip="Expand note editor"),
            ])
        elif not note:
            self.editor.content = ft.Column([
                th.eyebrow("Editor"), ft.Container(height=18),
                th.body("Select a note to view or edit it. Use New note in the explorer to begin."),
            ], spacing=0)
        else:
            controls = []
            if self.compact_editor:
                controls.append(ft.Row([ft.Container(expand=True),
                    th.secondary_action("Collapse editor", lambda e: self.toggle_editor(), tooltip="Collapse note editor")]))
            controls.append(self._editor_fields(note))
            self.editor.content = ft.Column(controls, spacing=6, expand=True)
        if self.editor.page: self.editor.update()

    def toggle_editor(self):
        self.editor_collapsed = not self.editor_collapsed
        self.render_editor()
        if self.on_editor_toggle:
            self.on_editor_toggle(self.editor_collapsed)

    def duplicate(self, note):
        duplicate = repo.duplicate_world_note(note.id)
        if duplicate: self.reload(duplicate.id)

    def delete(self, note):
        def confirmed(_):
            try: repo.delete_world_note(note.id)
            except Exception as exc:
                th.snack(self.page, f"Could not delete note: {exc}", True); return
            if self.page.overlay: self.page.overlay.pop()
            self.drafts.pop(note.id, None); self.selected_id = None
            self.reload(); self.page.update()
        th.overlay(self.page, f"Delete {note.title or 'this note'}?",
                   th.body("Its content cannot be recovered."),
                   [th.destructive_action("Delete the note", confirmed)], "Confirmation")

    def new_note(self, category=None):
        title = th.UnderlinedField("Title", "", autofocus=True)
        content = th.UnderlinedField("Note", "", multiline=True, lines=9)
        values = {"category": category or "Unsorted", "context": "relevant", "pin": False, "saving": False}
        pin_label = th.caption("Not pinned")
        def toggle_pin(_):
            values["pin"] = not values["pin"]
            pin_label.value = "Pinned" if values["pin"] else "Not pinned"
            if pin_label.page: pin_label.update()
        def save(_):
            if values["saving"]: return
            values["saving"] = True
            try:
                item = WorldNote(world_id=self.world_id, title=title.value.strip(), content=content.value,
                                 category=values["category"], context_mode=values["context"], is_pinned=values["pin"])
                repo.save_world_note(item)
            except Exception as exc:
                values["saving"] = False; th.snack(self.page, f"Could not create note: {exc}", True); return
            if self.page.overlay: self.page.overlay.pop()
            self.reload(item.id); self.page.update()
        th.overlay(self.page, "Give the idea somewhere to live.", ft.Column([
            title, content,
            th.select_row("Category", values["category"], [(x, x) for x in NOTE_CATEGORIES], lambda v: values.__setitem__("category", v)),
            th.select_row("Assistant context", values["context"], CONTEXT_OPTIONS, lambda v: values.__setitem__("context", v)),
            ft.Row([th.secondary_action("Toggle pin", toggle_pin), pin_label], spacing=12),
        ], spacing=16), [th.text_action("Create note →", save, size=28)], "New note")

    def focus_mode(self, note):
        th.overlay(self.page, note.title or "Untitled note", self._editor_fields(note, True), [], "Focus editor")

    def switcher(self):
        query = th.UnderlinedField("Switch note", "", hint="Search title or content…", autofocus=True)
        results = ft.Column(spacing=4)
        def update(_=None):
            matches = filter_notes(self.notes, query.value, "all")[:12]
            results.controls = [th.secondary_action(
                f"{n.title or 'Untitled'}  ·  {n.category}",
                lambda e, nid=n.id: self._switch_from_overlay(nid)) for n in matches]
            if results.page: results.update()
        query.text_field.on_change = update; update()
        th.overlay(self.page, "Find a note without leaving the conversation.",
                   ft.Column([query, results], spacing=18), [], "Note switcher")

    def _switch_from_overlay(self, note_id):
        if self.page.overlay: self.page.overlay.pop()
        self.select(note_id); self.page.update()

    def browser_panel(self):
        return ft.Column([
            ft.Row([th.eyebrow("Notes"), ft.Container(expand=True),
                    th.secondary_action("New note", lambda e: self.new_note())]),
            self.search, th.text_tabs(["All", "Recent", "Pinned"], self.filter.title(), self.set_filter, neutral=True),
            self.browser,
        ], spacing=12, expand=True)


def standalone_notes_panel(page: ft.Page, world_id: int) -> ft.Control:
    """Permanent explorer/editor used by World > Notes."""
    ctl = NotesController(page, world_id)
    available_height = max(360, int(float(getattr(page, "height", 820) or 820) - 190))
    split = ft.Row([
        ft.Container(ctl.browser_panel(), expand=4), th.vrule(650),
        ft.Container(ctl.editor, expand=6),
    ], spacing=34, expand=True, height=available_height)
    return ft.Container(split, height=available_height)


def notes_workspace_view(page: ft.Page, world_id: int) -> ft.View:
    world = repo.get_world(world_id)
    if not world: raise ValueError("World not found")
    provider = get_provider()
    ctl = NotesController(page, world_id, compact_editor=True)
    state = {"busy": False, "notes_visible": True}
    chat = ft.ListView(expand=True, spacing=24, auto_scroll=True,
                       build_controls_on_demand=True,
                       padding=ft.padding.only(right=8))
    composer = th.UnderlinedField("Ask the writing assistant", "", hint="Develop the world…", multiline=True, lines=1)
    context_text = th.caption("No notes will be sent with the next request.")
    notes_host = ft.Container(expand=5, visible=True)

    def open_note(note_id):
        note = repo.get_world_note(note_id)
        if not note or note.lifecycle_status != "canonical":
            th.snack(page, "That note is no longer available.", True); return
        state["notes_visible"] = True; notes_host.visible = True
        ctl.select(note_id)
        if float(getattr(page, "width", 1280) or 1280) < 760:
            th.overlay(page, "Browse and edit world notes.", notes_host.content, [], "Notes")
        else:
            page.update()

    def tap_link(event):
        url = getattr(event, "data", "") or getattr(event, "url", "")
        if str(url).startswith("app-note://"):
            try: open_note(int(str(url).split("//", 1)[1]))
            except ValueError: th.snack(page, "That note link is invalid.", True)

    def proposal_card(suggestion):
        payload = suggestion["payload"]
        action = suggestion["action_type"]
        title = suggestion.get("note_title") or payload.get("title") or "Untitled note"
        status = suggestion["status"]
        label = {"create":"Create", "append":"Add to", "replace":"Replace", "open":"Open"}.get(action, action.title())
        actions = []
        if action == "open":
            actions.append(th.secondary_action(
                "Open note →", lambda e, s=suggestion: open_proposal(s)))
        elif status == "pending":
            actions.extend([
                th.secondary_action("Review", lambda e, s=suggestion: review_one(s)),
                th.text_action("Accept →", lambda e, s=suggestion: approve(s), size=20),
                th.destructive_action("Reject", lambda e, sid=suggestion["id"]: reject(sid)),
            ])
        else:
            actions.append(th.caption(status.title()))
        return ft.Column([
            th.rule(.64), ft.Row([th.eyebrow(f"Note proposal · {label}"), ft.Container(expand=True), th.mono_caption(status)]),
            th.display(title, 22), th.caption((payload.get("content") or "")[:180], max_lines=2, overflow=ft.TextOverflow.ELLIPSIS),
            ft.Row(actions, spacing=20),
        ], spacing=7)

    def open_proposal(suggestion):
        repo.set_note_suggestion_status(suggestion["id"], "approved")
        open_note(suggestion["target_note_id"])
        refresh_chat()

    def approve(suggestion, edited=None):
        payload = dict(suggestion["payload"]); payload.update(edited or {})
        note = repo.get_world_note(suggestion["target_note_id"])
        if not note:
            th.snack(page, "This proposal no longer has a note.", True); return
        if suggestion["action_type"] == "append":
            content = note.content.rstrip() + "\n\n" + str(payload.get("content", "")).strip()
        elif suggestion["action_type"] == "replace": content = str(payload.get("content", ""))
        else: content = str(payload.get("content", note.content))
        try:
            nid = repo.approve_note_suggestion(
                suggestion["id"], payload.get("title", note.title), content,
                payload.get("category", note.category), payload.get("context_mode", note.context_mode),
                bool(payload.get("is_pinned", note.is_pinned)),
            )
        except Exception as exc:
            th.snack(page, f"Could not approve proposal: {exc}", True); return
        if page.overlay: page.overlay.pop()
        ctl.reload(nid); refresh_chat(); page.update()

    def reject(suggestion_id):
        repo.set_note_suggestion_status(suggestion_id, "rejected")
        refresh_chat(); page.update()

    def review_one(suggestion):
        payload = suggestion["payload"]
        note = repo.get_world_note(suggestion["target_note_id"])
        title = th.UnderlinedField("Title", payload.get("title", note.title if note else ""))
        content = th.UnderlinedField("Proposed text", payload.get("content", ""), multiline=True, lines=12)
        values = {"category": payload.get("category", note.category if note else "Unsorted"),
                  "context": payload.get("context_mode", note.context_mode if note else "relevant"),
                  "pin": bool(payload.get("is_pinned", note.is_pinned if note else False))}
        before = ""
        if suggestion["action_type"] in {"append", "replace"} and note:
            before = f"Current version\n{note.content}\n\nProposed {suggestion['action_type']}"
        th.overlay(page, "Review before it becomes canon.", ft.Column([
            *([th.caption(before, max_lines=8, overflow=ft.TextOverflow.ELLIPSIS)] if before else []),
            title, content,
            th.select_row("Category", values["category"], [(x, x) for x in NOTE_CATEGORIES], lambda v: values.__setitem__("category", v)),
            th.select_row("Assistant context", values["context"], CONTEXT_OPTIONS, lambda v: values.__setitem__("context", v)),
        ], spacing=14), [th.text_action("Approve change →", lambda e: approve(suggestion, {
            "title": title.value, "content": content.value, "category": values["category"],
            "context_mode": values["context"], "is_pinned": values["pin"],
        }), size=27), th.destructive_action("Reject", lambda e: reject(suggestion["id"]))], "Note proposal")

    def chat_turn(message, latest_assistant_id=None):
        user = message.role == "user"
        linked = link_note_references(message.content, ctl.notes)
        markdown = th.md(linked, th.MUTED if user else th.TEXT_DIM, on_tap_link=tap_link)
        rows = [th.display("You" if user else "Writing assistant", 19, th.MUTED_2 if user else th.TEXT_1), markdown]
        if not user:
            rows.extend(proposal_card(s) for s in repo.list_note_suggestions(message.id))
            message_actions = []
            if message.id == latest_assistant_id:
                message_actions.append(th.secondary_action(
                    "Regenerate", lambda e, mid=message.id: page.run_task(regenerate, mid)))
            message_actions.append(th.destructive_action(
                "Delete response", lambda e, mid=message.id: delete_response(mid)))
            rows.append(ft.Row(message_actions, spacing=18))
        return ft.Container(ft.Column(rows, spacing=6), margin=ft.margin.only(left=60 if user else 0))

    def import_unparsed_actions():
        """Upgrade raw legacy assistant JSON in place when it is recognizable."""
        valid_ids = repo.list_workspace_note_ids(world_id)
        for message in repo.list_note_chat_messages(world_id):
            if message.role != "assistant" or repo.list_note_suggestions(message.id):
                continue
            visible, actions = parse_note_actions(message.content, valid_ids)
            if not actions:
                continue
            repo.update_note_chat_message(message.id, visible)
            for action in actions:
                repo.save_note_suggestion(message.id, action.ordinal, action.action_type,
                                          action.target_note_id, action.payload)
            valid_ids = repo.list_workspace_note_ids(world_id)

    def refresh_chat():
        messages = repo.list_note_chat_messages(world_id)
        latest_assistant = next((m.id for m in reversed(messages) if m.role == "assistant"), None)
        chat.controls = [chat_turn(m, latest_assistant) for m in messages]
        if chat.page: chat.update()

    def context_selection(text=""):
        return select_notes_for_context(ctl.notes, text, repo.list_note_chat_messages(world_id), ctl.selected_id)

    def render_context(text=""):
        selected = context_selection(text)
        context_text.value = f"{len(selected)} notes in context" if selected else "No notes in context"
        if context_text.page: context_text.update()

    async def generate_response(request_id: int):
        history = repo.list_note_chat_messages(world_id)
        request = next((m for m in history if m.id == request_id), None)
        if not request: return
        selected = context_selection(request.content)
        built = build_notes_chat_prompt(world, [x.note for x in selected], history,
            {x.note.id: x.reason for x in selected}, repo.list_workspace_proposal_ledger(world_id))
        parts = []
        try:
            async for chunk in provider.stream_chat(built, repo.get_settings()): parts.append(chunk)
        except ProviderError as exc:
            th.snack(page, str(exc), True); return
        response = "".join(parts).strip()
        visible, actions = parse_note_actions(response, repo.list_workspace_note_ids(world_id))
        message_id = repo.add_note_chat_message(world_id, "assistant", visible)
        repo.save_note_prompt_usage(request_id, [(x.note.id, note_fingerprint(x.note), x.reason) for x in selected])
        for action in actions:
            try: repo.save_note_suggestion(message_id, action.ordinal, action.action_type, action.target_note_id, action.payload)
            except ValueError:
                # Preserve malformed/expired actions as readable assistant text.
                repo.update_note_chat_message(message_id, (visible + "\n\nCouldn’t prepare one note action because its target no longer exists.").strip())
        ctl.reload(ctl.selected_id); refresh_chat(); render_context()

    async def send(_=None):
        text = composer.value.strip()
        if state["busy"] or not text: return
        state["busy"] = True
        request_id = repo.add_note_chat_message(world_id, "user", text)
        composer.value = ""; refresh_chat()
        try: await generate_response(request_id)
        finally: state["busy"] = False

    async def regenerate(message_id=None):
        if state["busy"]: return
        history = repo.list_note_chat_messages(world_id)
        assistant = next((m for m in reversed(history) if m.role == "assistant" and (message_id is None or m.id == message_id)), None)
        if not assistant:
            th.snack(page, "There is no assistant response to regenerate.", True); return
        request = next((m for m in reversed(history) if m.role == "user" and m.id < assistant.id), None)
        if not request:
            th.snack(page, "There is no user message for this response.", True); return
        state["busy"] = True
        repo.delete_note_chat_message(assistant.id); refresh_chat()
        try: await generate_response(request.id)
        finally: state["busy"] = False

    def delete_response(message_id):
        repo.delete_note_chat_message(message_id); refresh_chat(); page.update()

    def review_all(_=None):
        pending = repo.list_pending_note_suggestions(world_id)
        th.overlay(page, "Review what the assistant wants to change.",
                   ft.ListView([proposal_card(s) for s in pending] or [th.body("Nothing is waiting for review.")], spacing=18),
                   [], "Proposed edits")

    def review_context(_=None):
        rows = [(x.note.title or "Untitled", x.reason) for x in context_selection(composer.value)]
        th.overlay(page, "What the assistant will receive next.", th.disclosure("Notes in context", rows) if rows else th.body("No notes qualify for the next message."), [], "Assistant context")

    def toggle_notes(_=None):
        if float(getattr(page, "width", 1280) or 1280) < 760:
            th.overlay(page, "Browse and edit world notes.", notes_host.content, [], "Notes")
            return
        state["notes_visible"] = not state["notes_visible"]
        notes_host.visible = state["notes_visible"]
        if notes_host.page: notes_host.update()

    def keyboard(event):
        if event.key.lower() == "k" and (getattr(event, "ctrl", False) or getattr(event, "meta", False)):
            state["notes_visible"] = True; notes_host.visible = True; ctl.switcher()
        elif event.key == "Escape" and page.overlay:
            page.overlay.pop(); page.update()
    page.on_keyboard_event = keyboard

    def clear_conversation(_=None):
        def confirmed(_):
            repo.clear_note_chat(world_id)
            if page.overlay: page.overlay.pop()
            ctl.reload(); refresh_chat(); page.update()
        th.overlay(page, "Clear this writing conversation?",
                   th.body("Canonical notes remain. The transcript and unapproved workspace proposals will be removed."),
                   [th.destructive_action("Clear conversation", confirmed)], "Confirmation")

    composer.text_field.on_submit = send
    composer.text_field.on_change = lambda e: render_context(e.control.value or "")
    import_unparsed_actions(); ctl.reload(); refresh_chat(); render_context()
    browser_section = ft.Container(ctl.browser_panel(), expand=4)
    editor_section = ft.Container(ctl.editor, expand=6)
    split = {"browser": 4, "editor": 6}
    def resize_editor(collapsed):
        split["browser"], split["editor"] = ((9, 1) if collapsed else (4, 6))
        browser_section.expand, editor_section.expand = split["browser"], split["editor"]
        if browser_section.page:
            browser_section.update(); editor_section.update()
    def drag_divider(event):
        delta = event.delta_y or 0
        if abs(delta) < 1: return
        split["browser"] = max(2, min(8, split["browser"] + (1 if delta > 0 else -1)))
        split["editor"] = 10 - split["browser"]
        ctl.editor_collapsed = False
        browser_section.expand, editor_section.expand = split["browser"], split["editor"]
        if browser_section.page:
            browser_section.update(); editor_section.update()
    ctl.on_editor_toggle = resize_editor
    divider = ft.Container(ft.GestureDetector(
        content=ft.Container(th.rule(.72), height=12, alignment=ft.alignment.center),
        mouse_cursor=ft.MouseCursor.RESIZE_UP_DOWN,
        on_vertical_drag_update=drag_divider,
    ), tooltip="Drag to resize note browser and editor")
    notes_host.content = ft.Column([
        browser_section, divider, editor_section,
    ], spacing=4, expand=True)
    conversation = ft.Column([
        ft.Row([th.eyebrow("Writing assistant"), ft.Container(expand=True),
                th.secondary_action("Review proposals", review_all),
                th.secondary_action("Show or hide notes", toggle_notes, tooltip="Show or hide notes")]),
        chat,
        ft.Row([context_text, th.secondary_action("Review context", review_context)]),
        ft.Row([ft.Container(composer, expand=True), th.text_action("Send →", lambda e: page.run_task(send), size=25)], spacing=18),
    ], spacing=12, expand=True)
    narrow = float(getattr(page, "width", 1280) or 1280) < 760
    available_height = max(360, int(float(getattr(page, "height", 820) or 820) - 265))
    if narrow:
        state["notes_visible"] = False; notes_host.visible = False
        workspace = ft.Container(conversation, height=available_height)
    else:
        workspace = ft.Container(ft.Row([
            ft.Container(conversation, expand=7),
            ft.Container(width=1, gradient=th.vrule(650).gradient), notes_host,
        ], spacing=30, expand=True), height=available_height)
    body = ft.Column([
        th.eyebrow("World notes"), ft.Container(height=6),
        th.display(f"{world.name} stays private here.", 48),
        th.body("Develop the world beside the conversation; only the context named below reaches this assistant."),
        ft.Container(height=18), workspace,
    ], spacing=0, expand=True)
    return th.screen(page, f"/world/{world_id}/notes", body,
        back_route=f"/world/{world_id}/notes-list", back_label=world.name,
        right_actions=[
            th.secondary_action("New note", lambda e: ctl.new_note()),
            th.secondary_action("Regenerate", lambda e: page.run_task(regenerate), tooltip="Regenerate the latest assistant response"),
            th.destructive_action("Clear conversation", clear_conversation),
        ])
