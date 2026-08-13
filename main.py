"""Character Chat - entry point.

A visual-novel-style app for chatting with your fictional characters
using local AI models (any OpenAI-compatible endpoint).
"""

import flet as ft

from app.database import init_db
from app.ui import theme as th
from app.ui.router import route_change, view_pop


def main(page: ft.Page):
    page.title = "Character Chat"
    page.window.width = 1280
    page.window.height = 820
    page.window.min_width = 960
    page.window.min_height = 640
    page.theme_mode = ft.ThemeMode.DARK
    page.bgcolor = th.BG
    page.padding = 0

    page.fonts = dict(th.FONTS)
    settings = __import__("app.repository", fromlist=["get_settings"]).get_settings()
    th.configure_accessibility(
        settings.get("reduce_motion", "0") == "1",
        float(settings.get("text_scale", "1.0")),
    )
    page.theme = ft.Theme(
        font_family=th.BODY_FONT,
        color_scheme=ft.ColorScheme(
            primary=th.ACCENT,
            on_primary=th.BG,
            primary_container=th.BG2,
            on_primary_container=th.TEXT_1,
            secondary=th.ACCENT_2,
            on_secondary=th.BG,
            secondary_container=th.BG2,
            on_secondary_container=th.TEXT_1,
            tertiary=th.ACCENT,
            error=th.BAD,
            on_error=th.TEXT_1,
            background=th.BG,
            on_background=th.TEXT_1,
            surface=th.BG,
            on_surface=th.TEXT_1,
            surface_variant=th.BG2,
            on_surface_variant=th.TEXT_DIM,
            surface_tint=ft.Colors.TRANSPARENT,
            outline=th.LINE,
            outline_variant=th.LINE,
            shadow=ft.Colors.TRANSPARENT,
            inverse_surface=th.TEXT_1,
            on_inverse_surface=th.BG,
        ),
        scaffold_bgcolor=th.BG,
        canvas_color=th.BG,
        dialog_bgcolor=th.BG,
        divider_color=th.LINE,
        hint_color=th.MUTED_2,
        shadow_color=ft.Colors.TRANSPARENT,
        splash_color=ft.Colors.TRANSPARENT,
        highlight_color=ft.Colors.TRANSPARENT,
        hover_color=ft.Colors.with_opacity(0.06, ft.Colors.WHITE),
        focus_color=ft.Colors.with_opacity(0.12, th.ACCENT),
        appbar_theme=ft.AppBarTheme(bgcolor=ft.Colors.TRANSPARENT, elevation=0),
        scrollbar_theme=ft.ScrollbarTheme(
            thumb_color=ft.Colors.with_opacity(0.14, ft.Colors.WHITE),
            thickness=6,
            radius=3,
        ),
        tooltip_theme=ft.TooltipTheme(
            text_style=ft.TextStyle(font_family=th.BODY_FONT, size=12, color=th.TEXT_1),
            decoration=ft.BoxDecoration(
                bgcolor=th.BG2,
            ),
        ),
        page_transitions=ft.PageTransitionsTheme(
            windows=ft.PageTransitionTheme.FADE_UPWARDS,
            macos=ft.PageTransitionTheme.FADE_UPWARDS,
            linux=ft.PageTransitionTheme.FADE_UPWARDS,
        ),
    )

    # theme_mode is DARK, so dark_theme is the one that actually applies.
    page.dark_theme = page.theme

    init_db()

    page.on_route_change = route_change
    page.on_view_pop = view_pop
    page.go(page.route or "/")


if __name__ == "__main__":
    ft.app(main, assets_dir="assets")
