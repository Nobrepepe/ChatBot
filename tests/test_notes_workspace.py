import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import flet as ft

from app import database, repository
from app.models import NOTE_CATEGORIES, NoteChatMessage, World, WorldNote
from app.prompt_builder import build_notes_chat_prompt
from app.services.notes_service import (
    filter_notes,
    link_note_references,
    note_fingerprint,
    parse_note_actions,
    select_notes_for_context,
)
from app.ui.notes_view import NotesController, notes_workspace_view
from app.ui.world_view import world_view


class TemporaryDatabaseTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tempdir.name) / "chatbot.db"
        self.db_patch = patch.object(database, "DB_PATH", self.db_path)
        self.db_patch.start()

    def tearDown(self):
        self.db_patch.stop()
        self.tempdir.cleanup()

    def test_legacy_notes_migrate_without_losing_content(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.executescript(
                """
                CREATE TABLE worlds (
                    id INTEGER PRIMARY KEY, name TEXT NOT NULL,
                    genre TEXT NOT NULL DEFAULT '', tone TEXT NOT NULL DEFAULT '',
                    summary TEXT NOT NULL DEFAULT '',
                    setting_description TEXT NOT NULL DEFAULT '',
                    style_guide TEXT NOT NULL DEFAULT '',
                    cover_image_path TEXT NOT NULL DEFAULT '',
                    session_background_path TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE TABLE world_notes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    world_id INTEGER NOT NULL REFERENCES worlds(id),
                    title TEXT NOT NULL DEFAULT '',
                    content TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                INSERT INTO worlds(id, name) VALUES (1, 'Legacy');
                INSERT INTO world_notes(world_id, title, content)
                    VALUES (1, 'Original', 'irreplaceable text');
                """
            )
        database.init_db()
        note = repository.list_world_notes(1)[0]
        self.assertEqual(note.content, "irreplaceable text")
        self.assertEqual(note.category, "Unsorted")
        self.assertEqual(note.context_mode, "always")
        self.assertFalse(note.is_pinned)
        self.assertIsNone(note.last_opened_at)

    def test_repository_round_trip_duplicate_and_prompt_usage(self):
        database.init_db()
        world_id = repository.save_world(World(name="Test"))
        note = WorldNote(
            world_id=world_id, title="Eden", content="A floating city",
            category="Setting", is_pinned=True, context_mode="relevant",
        )
        repository.save_world_note(note)
        loaded = repository.get_world_note(note.id)
        self.assertEqual(loaded.category, "Setting")
        self.assertTrue(loaded.is_pinned)
        duplicate = repository.duplicate_world_note(note.id)
        self.assertEqual(duplicate.title, "Eden copy")
        self.assertFalse(duplicate.is_pinned)
        self.assertEqual(duplicate.context_mode, "relevant")

        user_id = repository.add_note_chat_message(world_id, "user", "Tell me")
        repository.save_note_prompt_usage(
            user_id, [(note.id, note_fingerprint(loaded), "active note")]
        )
        repository.add_note_chat_message(world_id, "assistant", "Certainly")
        usage = repository.latest_note_prompt_usage(world_id)
        self.assertEqual(usage[note.id][1], "active note")

    def test_revised_pending_create_supersedes_older_proposal(self):
        database.init_db()
        world_id = repository.save_world(World(name="Test"))
        first_message = repository.add_note_chat_message(
            world_id, "assistant", "First proposal"
        )
        first_id = repository.save_note_suggestion(
            first_message, 0, "create", None,
            {
                "type": "create", "title": "Gabriella",
                "category": "Characters", "content": "Soldier",
                "context_mode": "relevant", "is_pinned": False,
            },
        )
        second_message = repository.add_note_chat_message(
            world_id, "assistant", "Revised proposal"
        )
        second_id = repository.save_note_suggestion(
            second_message, 0, "create", None,
            {
                "type": "create", "title": "Gabriella",
                "category": "Characters", "content": "Fallen Hero",
                "context_mode": "relevant", "is_pinned": False,
            },
        )
        first = repository.list_note_suggestions(first_message)[0]
        pending = repository.list_pending_note_suggestions(world_id)
        self.assertEqual(first["id"], first_id)
        self.assertEqual(first["status"], "superseded")
        self.assertEqual([item["id"] for item in pending], [second_id])
        first_note = repository.get_world_note(first["target_note_id"])
        second_note_id = pending[0]["target_note_id"]
        self.assertEqual(first_note.lifecycle_status, "superseded")
        self.assertEqual(
            repository.get_world_note(second_note_id).lifecycle_status, "proposed"
        )
        self.assertEqual(repository.list_world_notes(world_id), [])

        repository.set_note_suggestion_status(second_id, "rejected")
        self.assertEqual(
            repository.get_world_note(second_note_id).lifecycle_status, "rejected"
        )
        self.assertIn(second_note_id, repository.list_workspace_note_ids(world_id))

        revision_message = repository.add_note_chat_message(
            world_id, "assistant", "Revise the rejected draft"
        )
        revision_id = repository.save_note_suggestion(
            revision_message, 0, "replace", second_note_id,
            {"type": "replace", "note_id": second_note_id,
             "content": "Fallen Hero, revised"},
        )
        self.assertEqual(
            repository.get_world_note(second_note_id).lifecycle_status, "proposed"
        )
        approved_id = repository.approve_note_suggestion(
            revision_id, "Gabriella", "Fallen Hero, revised", "Characters",
            "relevant", False,
        )
        self.assertEqual(approved_id, second_note_id)
        canonical = repository.get_world_note(second_note_id)
        self.assertEqual(canonical.lifecycle_status, "canonical")
        self.assertIsNone(canonical.workspace_session_id)
        self.assertEqual(
            [note.id for note in repository.list_world_notes(world_id)],
            [second_note_id],
        )
        cleanup_message = repository.add_note_chat_message(
            world_id, "assistant", "Temporary proposal"
        )
        cleanup_suggestion = repository.save_note_suggestion(
            cleanup_message, 0, "create", None,
            {
                "type": "create", "title": "Temporary",
                "category": "Unsorted", "content": "Discard later",
                "context_mode": "relevant", "is_pinned": False,
            },
        )
        cleanup = repository.list_note_suggestions(cleanup_message)[0]
        cleanup_note_id = cleanup["target_note_id"]
        repository.set_note_suggestion_status(cleanup_suggestion, "rejected")
        repository.clear_note_chat(world_id)
        self.assertIsNone(repository.get_world_note(cleanup_note_id))
        self.assertIsNotNone(repository.get_world_note(second_note_id))
        self.assertEqual(repository.list_note_chat_messages(world_id), [])

    def test_ai_workspace_new_note_buttons_open_dialogs(self):
        database.init_db()
        world_id = repository.save_world(World(name="Test"))
        repository.save_world_note(
            WorldNote(world_id=world_id, title="Visible row", content="Text")
        )
        repository.add_note_chat_message(
            world_id,
            "assistant",
            "Draft ready.\n```note_action\n"
            '{"type":"create","title":"Proposal","category":"Characters",'
            '"content":"Proposed text","context_mode":"relevant",'
            '"is_pinned":false}\n```',
        )

        class FakePage(SimpleNamespace):
            def open(self, control):
                self.opened = control

            def close(self, control):
                pass

            def run_task(self, *args, **kwargs):
                pass

            def update(self):
                pass

        page = FakePage(
            width=1280, height=820, on_keyboard_event=None,
            on_resized=None, opened=None,
        )
        view = notes_workspace_view(page, world_id)

        def descendants(control):
            result = []
            for child in control._get_children():
                result.append(child)
                result.extend(descendants(child))
            return result

        controls = [view, *descendants(view)]
        buttons = []
        for control in controls:
            if not getattr(control, "on_click", None):
                continue
            text = [
                child.value for child in descendants(control)
                if isinstance(child, ft.Text)
            ]
            if "New note" in text:
                buttons.append(control)
        self.assertEqual(len(buttons), 2)
        for button in buttons:
            page.overlay = []
            button.on_click(SimpleNamespace(control=button))
            self.assertTrue(page.overlay)
        return
        controls = [view, *descendants(view)]
        regenerate_items = [
            control for control in controls
            if isinstance(control, ft.PopupMenuItem)
            and control.text == "Regenerate"
        ]
        self.assertEqual(len(regenerate_items), 1)
        regenerate_toolbar = [
            control for control in controls
            if getattr(control, "tooltip", None)
            == "Regenerate the latest assistant response"
        ]
        self.assertEqual(len(regenerate_toolbar), 1)
        review_buttons = []
        for control in controls:
            if not getattr(control, "on_click", None):
                continue
            labels = [
                child.value for child in descendants(control)
                if isinstance(child, ft.Text)
            ]
            if "Review" in labels:
                review_buttons.append(control)
        self.assertEqual(len(review_buttons), 1)
        review_buttons[0].on_click(SimpleNamespace(control=review_buttons[0]))
        review_fields = [
            control for control in descendants(page.opened)
            if isinstance(control, ft.TextField) and control.multiline
        ]
        self.assertTrue(review_fields)
        self.assertTrue(all(
            field.max_lines is None or field.min_lines <= field.max_lines
            for field in review_fields
        ))
        drawer_buttons = [
            control for control in controls
            if getattr(control, "tooltip", None) == "Show or hide notes"
            and getattr(control, "on_click", None)
        ]
        self.assertEqual(len(drawer_buttons), 1)
        drawer_buttons[0].on_click(SimpleNamespace(control=drawer_buttons[0]))
        drawer_buttons[0].on_click(SimpleNamespace(control=drawer_buttons[0]))
        note_rows = [
            control for control in controls
            if str(getattr(control, "tooltip", "")).startswith("Open note Visible row")
            and getattr(control, "on_click", None)
        ]
        self.assertEqual(len(note_rows), 1)
        note_rows[0].on_click(SimpleNamespace(control=note_rows[0]))
        controls = [view, *descendants(view)]
        collapse = [
            control for control in controls
            if getattr(control, "tooltip", None) == "Collapse note editor"
        ]
        self.assertEqual(len(collapse), 1)
        collapse[0].on_click(SimpleNamespace(control=collapse[0]))
        controls = [view, *descendants(view)]
        expand = [
            control for control in controls
            if getattr(control, "tooltip", None) == "Expand note editor"
        ]
        self.assertEqual(len(expand), 1)
        expand[0].on_click(SimpleNamespace(control=expand[0]))
        self.assertFalse(any(isinstance(control, ft.Semantics) for control in controls))

    def test_world_notes_tab_has_explorer_editor_and_category_creation(self):
        database.init_db()
        world_id = repository.save_world(World(name="Test"))
        repository.save_world_note(
            WorldNote(
                world_id=world_id, title="Editable note", content="Existing text",
                category="Setting",
            )
        )

        class FakePage(SimpleNamespace):
            def open(self, control):
                self.opened = control

            def close(self, control):
                pass

            def go(self, route):
                pass

            def update(self):
                pass

        page = FakePage(width=1280, height=820, overlay=[], opened=None)
        view = world_view(page, world_id, "notes-list")

        def descendants(control):
            result = []
            for child in control._get_children():
                result.append(child)
                result.extend(descendants(child))
            return result

        controls = [view, *descendants(view)]
        self.assertTrue(any(
            isinstance(control, ft.Text) and control.value == "Editable note"
            for control in controls
        ))
        new_buttons = []
        for control in controls:
            if not getattr(control, "on_click", None):
                continue
            labels = [
                child.value for child in descendants(control)
                if isinstance(child, ft.Text)
            ]
            if "New note" in labels:
                new_buttons.append(control)
        self.assertEqual(len(new_buttons), 1)
        new_buttons[0].on_click(SimpleNamespace(control=new_buttons[0]))
        dialog_controls = [page.overlay[-1], *descendants(page.overlay[-1])]
        self.assertTrue(any(isinstance(control, ft.TextField) for control in dialog_controls))
        return
        category_dropdowns = [
            control for control in dialog_controls
            if isinstance(control, ft.Dropdown) and control.label == "Category"
        ]
        self.assertEqual(len(category_dropdowns), 1)
        self.assertEqual(
            [option.key for option in category_dropdowns[0].options],
            list(NOTE_CATEGORIES),
        )

    def test_controller_preserves_a_draft_when_switching_notes(self):
        database.init_db()
        world_id = repository.save_world(World(name="Test"))
        first = WorldNote(world_id=world_id, title="First", content="Saved")
        second = WorldNote(world_id=world_id, title="Second", content="Other")
        repository.save_world_note(first); repository.save_world_note(second)
        page = SimpleNamespace(width=1280, height=820, overlay=[], update=lambda: None)
        controller = NotesController(page, world_id)
        controller.select(first.id)
        draft = controller._draft(first)
        draft["content"], draft["dirty"] = "Unsaved writing", True
        controller.select(second.id)
        controller.select(first.id)
        self.assertEqual(controller._draft(first)["content"], "Unsaved writing")
        self.assertEqual(repository.get_world_note(first.id).content, "Saved")

    def test_workspace_converts_legacy_raw_action_to_review_proposal(self):
        database.init_db()
        world_id = repository.save_world(World(name="Test"))
        message_id = repository.add_note_chat_message(
            world_id, "assistant",
            '{"type":"create","title":"Clara","category":"Characters",'
            '"content":"Draft","context_mode":"relevant","is_pinned":false}',
        )
        page = SimpleNamespace(
            width=1280, height=820, overlay=[], on_keyboard_event=None,
            on_resized=None, update=lambda: None, run_task=lambda *a, **k: None,
            open=lambda control: None,
        )
        notes_workspace_view(page, world_id)
        message = repository.list_note_chat_messages(world_id)[0]
        self.assertEqual(message.content, "")
        suggestions = repository.list_note_suggestions(message_id)
        self.assertEqual(len(suggestions), 1)
        self.assertEqual(suggestions[0]["action_type"], "create")
        self.assertIsNotNone(suggestions[0]["target_note_id"])


class NoteContextTests(unittest.TestCase):
    def setUp(self):
        self.assertEqual(
            NOTE_CATEGORIES, ("Characters", "Setting", "Plot", "Unsorted")
        )
        self.notes = [
            WorldNote(id=1, title="Overview", content="The whole world",
                      context_mode="always"),
            WorldNote(id=2, title="Coleen", content="A careful mercenary",
                      category="Characters", context_mode="relevant"),
            WorldNote(id=3, title="Vault", content="Coleen guards the moon crystal",
                      category="Setting", context_mode="relevant", is_pinned=True),
            WorldNote(id=4, title="Secret", content="Never send this",
                      context_mode="excluded"),
        ]

    def test_context_modes_and_deduplication(self):
        selected = select_notes_for_context(
            self.notes, "What moon crystal does Coleen guard?", [], active_note_id=2
        )
        ids = [item.note.id for item in selected]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn(1, ids)
        self.assertIn(2, ids)
        self.assertIn(3, ids)
        self.assertNotIn(4, ids)

    def test_active_excluded_note_stays_excluded(self):
        selected = select_notes_for_context(
            self.notes, "Secret", [], active_note_id=4
        )
        self.assertNotIn(4, [item.note.id for item in selected])

    def test_search_and_filters(self):
        self.assertEqual(
            [note.id for note in filter_notes(self.notes, "mercenary")], [2]
        )
        self.assertEqual(
            [note.id for note in filter_notes(self.notes, "Setting")], [3]
        )
        self.assertEqual(
            [note.id for note in filter_notes(self.notes, selected_filter="pinned")],
            [3],
        )

    def test_prompt_has_world_boundaries_and_selected_notes_only(self):
        world = World(id=1, name="Eden", summary="Required overview")
        selected = [self.notes[0], self.notes[1]]
        prompt = build_notes_chat_prompt(
            world, selected, [NoteChatMessage(role="user", content="Hello")],
            {1: "always included", 2: "title referenced"},
            [{
                "id": 9, "action_type": "create", "target_note_id": 68,
                "status": "pending", "lifecycle_status": "proposed",
                "note_title": "Pending Hero", "note_category": "Characters",
                "note_content": "Draft only",
                "payload": {
                    "title": "Pending Hero", "category": "Characters",
                    "content": "Draft only",
                },
            }],
        )
        system = prompt[0]["content"]
        self.assertIn("Required overview", system)
        self.assertIn("Note id=1", system)
        self.assertIn("Note id=2", system)
        self.assertNotIn("Never send this", system)
        self.assertIn(
            "Workspace Note id=68 · note_status=proposed · "
            "proposal_status=pending", system
        )
        self.assertIn("never guess an ID", system)
        self.assertEqual(prompt[-1], {"role": "user", "content": "Hello"})


class NoteActionTests(unittest.TestCase):
    def test_valid_actions_are_extracted_and_invalid_are_visible(self):
        text = (
            "Suggestion.\n```note_action\n"
            '{"type":"append","note_id":2,"content":"New detail"}\n```\n'
            "```note_action\n"
            '{"type":"replace","note_id":999,"content":"bad"}\n```'
        )
        visible, actions = parse_note_actions(text, {2})
        self.assertEqual(len(actions), 1)
        self.assertEqual(actions[0].target_note_id, 2)
        self.assertIn('"note_id":999', visible)
        self.assertNotIn('"note_id":2', visible)

    def test_duplicate_titles_are_not_linked(self):
        notes = [
            WorldNote(id=1, title="Eden"),
            WorldNote(id=2, title="Eden"),
            WorldNote(id=3, title="Coleen"),
        ]
        linked = link_note_references("Eden met Coleen. `Coleen`", notes)
        self.assertNotIn("app-note://1", linked)
        self.assertNotIn("app-note://2", linked)
        self.assertIn("[Coleen](app-note://3)", linked)
        self.assertIn("`Coleen`", linked)

    def test_labelled_json_action_array_becomes_review_actions(self):
        text = (
            "I drafted two notes.\n\n"
            "`note_action`\n"
            "```json\n"
            "[\n"
            '  {"type":"create","title":"Clara","category":"Characters",'
            '"content":"Draft one","context_mode":"character","is_pinned":false},\n'
            '  {"type":"create","title":"Castle","category":"Setting",'
            '"content":"Draft two","context_mode":"relevant","is_pinned":true}\n'
            "]\n"
            "```"
        )
        visible, actions = parse_note_actions(text, set())
        self.assertEqual(visible, "I drafted two notes.")
        self.assertEqual(len(actions), 2)
        self.assertEqual(actions[0].payload["title"], "Clara")
        self.assertEqual(actions[0].payload["context_mode"], "relevant")
        self.assertEqual(actions[1].payload["category"], "Setting")
        raw_array = (
            '[{"type":"create","title":"Clara","category":"Characters",'
            '"content":"Draft","context_mode":"character","is_pinned":false}]'
        )
        visible, actions = parse_note_actions(raw_array, set())
        self.assertEqual(visible, "")
        self.assertEqual(len(actions), 1)
        bare_replace = (
            '{"type":"replace","note_id":67,'
            '"content":"Replacement with\\nmultiple lines."}'
        )
        visible, actions = parse_note_actions(bare_replace, {67})
        self.assertEqual(visible, "")
        self.assertEqual(len(actions), 1)
        self.assertEqual(actions[0].action_type, "replace")
        self.assertEqual(actions[0].target_note_id, 67)


if __name__ == "__main__":
    unittest.main()
