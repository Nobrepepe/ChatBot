import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import flet as ft

from app import database, repository
from app.models import Character, Scene, World
from app.ui.chat_view import chat_view
from app.ui.home_view import home_view
from app.ui.scene_setup_view import scene_setup_view
from app.ui.world_view import world_view


def descendants(control):
    result = []
    for child in control._get_children():
        result.append(child)
        result.extend(descendants(child))
    return result


class FakePage(SimpleNamespace):
    def go(self, route): self.route = route
    def update(self): pass
    def run_task(self, *args, **kwargs): pass
    def open(self, control): self.opened = control


class UIReachabilityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.patch = patch.object(database, "DB_PATH", Path(self.tmp.name) / "chatbot.db")
        self.patch.start(); database.init_db()
        self.page = FakePage(width=960, height=640, overlay=[], on_keyboard_event=None,
                             on_resized=None, route="", opened=None)
        self.world = World(name="Test world", tone="quiet")
        self.world.id = repository.save_world(self.world)
        self.character = Character(world_id=self.world.id, name="Aster",
                                   summary="Ready", tile_image_path="/tile.png")
        self.character.id = repository.save_character(self.character)

    def tearDown(self):
        self.patch.stop(); self.tmp.cleanup()

    def test_character_browse_uses_grid_not_hidden_row(self):
        view = world_view(self.page, self.world.id, "characters")
        controls = descendants(view)
        self.assertTrue(any(isinstance(x, ft.GridView) for x in controls))
        self.assertFalse(any(isinstance(x, ft.Row) and x.scroll == ft.ScrollMode.HIDDEN
                             for x in controls))

    def test_home_worlds_list_has_bounded_scroll_region(self):
        self.page.width, self.page.height = 1280, 820
        view = home_view(self.page)
        lists = [x for x in descendants(view) if isinstance(x, ft.ListView)]
        world_lists = [x for x in lists if x.expand]
        self.assertTrue(world_lists)
        self.assertTrue(any(isinstance(x, ft.Column) and x.height
                            for x in descendants(view)))

    def test_empty_sessions_has_prominent_start_action(self):
        view = world_view(self.page, self.world.id, "sessions")
        controls = descendants(view)
        actions = []
        for control in controls:
            if not getattr(control, "on_click", None):
                continue
            labels = [x.value for x in descendants(control) if isinstance(x, ft.Text)]
            if "Start a new scene →" in labels:
                actions.append(control)
        self.assertEqual(len(actions), 1)
        actions[0].on_click(SimpleNamespace(control=actions[0]))
        self.assertEqual(self.page.route, f"/world/{self.world.id}/scene/new")

    def test_scene_start_action_is_outside_scroll_region(self):
        view = scene_setup_view(self.page, self.world.id)
        controls = descendants(view)
        self.assertTrue(any(isinstance(x, ft.ListView) for x in controls))
        labels = [x.value for x in controls if isinstance(x, ft.Text)]
        self.assertIn("Begin the scene →", labels)

    def test_chat_composer_exists_at_minimum_window(self):
        scene = Scene(world_id=self.world.id, title="First scene",
                      character_ids=[self.character.id])
        scene.id = repository.save_scene(scene)
        view = chat_view(self.page, scene.id)
        controls = descendants(view)
        fields = [x for x in controls if isinstance(x, ft.TextField)]
        labels = [x.value for x in controls if isinstance(x, ft.Text)]
        self.assertTrue(fields)
        self.assertIn("Send →", labels)
        transcripts = [x for x in controls if isinstance(x, ft.ListView)
                       and x.auto_scroll and x.build_controls_on_demand]
        self.assertEqual(len(transcripts), 1)
        self.assertIsNone(transcripts[0].height)
        self.assertTrue(transcripts[0].expand)
        self.assertTrue(fields[0].shift_enter)

    def test_desktop_chat_has_bounded_scrollable_conversation(self):
        self.page.width, self.page.height = 1280, 820
        scene = Scene(world_id=self.world.id, title="Desktop scene",
                      character_ids=[self.character.id])
        scene.id = repository.save_scene(scene)
        controls = descendants(chat_view(self.page, scene.id))
        conversations = [x for x in controls if isinstance(x, ft.Column)
                         and x.height == 490 and x.expand]
        self.assertEqual(len(conversations), 1)
        transcripts = [x for x in controls if isinstance(x, ft.ListView)
                       and x.auto_scroll and x.build_controls_on_demand]
        self.assertEqual(len(transcripts), 1)
        self.assertTrue(transcripts[0].expand)


if __name__ == "__main__":
    unittest.main()
