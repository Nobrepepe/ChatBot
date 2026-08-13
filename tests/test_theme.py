import unittest
import flet as ft
from types import SimpleNamespace
from app.ui import theme as th


class ThemeContractTest(unittest.TestCase):
    def test_fonts_and_tokens(self):
        self.assertEqual(th.BG, "#0F1315")
        self.assertEqual(th.ACCENT, "#79CDD4")
        self.assertEqual(set(th.FONTS), {"Newsreader", "Newsreader Italic", "IBM Plex Sans"})

    def test_rule_fades_at_both_ends(self):
        gradient=th.rule().gradient
        self.assertEqual(gradient.colors[0], ft.Colors.TRANSPARENT)
        self.assertEqual(gradient.colors[-1], ft.Colors.TRANSPARENT)

    def test_portrait_contract(self):
        result=th.portrait("", "#5F93AB", 100, 140)
        self.assertIsInstance(result, tuple)
        self.assertEqual(len(result), 2)

    def test_text_action_is_not_a_box(self):
        action=th.text_action("Continue →", lambda e: None)
        self.assertIsNone(action.bgcolor)
        self.assertIsNone(action.border)
        self.assertIsNone(action.border_radius)

    def test_accessibility_configuration(self):
        th.configure_accessibility(True, 1.4)
        self.assertEqual(th.display("Headline", 10).size, 14)
        th.configure_accessibility(False, 1.0)

    def test_compact_layout_supports_minimum_window(self):
        page = SimpleNamespace(width=960, height=640)
        self.assertTrue(th.compact(page))
        self.assertEqual(th.gutter(page), 24)

    def test_character_art_preserves_alpha_without_shader_mask(self):
        tile = th.character_tile("/transparent.png", 160, 90)
        self.assertIsInstance(tile, ft.Image)
        portrait, _ = th.portrait("/transparent.png", "#5F93AB", 100, 140)
        self.assertTrue(any(isinstance(child, ft.Image) for child in portrait._get_children()))

    def test_collection_grid_scrolls_vertically(self):
        grid = th.responsive_grid([ft.Text("one")], 200, 150)
        self.assertIsInstance(grid, ft.GridView)
        self.assertTrue(grid.expand)


if __name__ == "__main__": unittest.main()
