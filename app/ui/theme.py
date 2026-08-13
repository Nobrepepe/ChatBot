"""Shared visual language for Character Chat's no-box interface."""

from __future__ import annotations

import asyncio
import colorsys
import zlib
import flet as ft

BG = "#0F1315"
BG2 = "#161C1F"
TEXT_1 = "#E4EEF1"
TEXT_DIM = "#AEBBC0"
MUTED = "#98A7AD"
MUTED_2 = "#85949A"
FAINT = "#66757B"
ACCENT = "#79CDD4"
ACCENT_2 = "#9D9FD6"
GOOD = "#7CC7A4"
BAD = "#CC7A6B"
LINE = ft.Colors.with_opacity(0.14, TEXT_1)
LINE_INPUT = ft.Colors.with_opacity(0.18, TEXT_1)

DISPLAY_FONT = "Newsreader"
DISPLAY_FONT_ITALIC = "Newsreader Italic"
BODY_FONT = "IBM Plex Sans"
FONTS = {
    DISPLAY_FONT: "/fonts/Newsreader.ttf",
    DISPLAY_FONT_ITALIC: "/fonts/Newsreader-Italic.ttf",
    BODY_FONT: "/fonts/IBMPlexSans.ttf",
}

_reduce_motion = False
_text_scale = 1.0


def configure_accessibility(reduce_motion: bool = False, text_scale: float = 1.0) -> None:
    global _reduce_motion, _text_scale
    _reduce_motion = bool(reduce_motion)
    _text_scale = max(1.0, min(1.4, float(text_scale)))


CHARACTER_COLORS: dict[str, str] = {
    "lirael": "#5F93AB", "morgana": "#7A5FA8", "olive": "#5D8FA0",
    "azmar": "#687FA9", "axel": "#588E9F", "sander": "#746FA6",
}


def character_color(character) -> str:
    name = str(getattr(character, "name", character) or "character").casefold()
    if name in CHARACTER_COLORS:
        return CHARACTER_COLORS[name]
    hue = 182 + (zlib.crc32(name.encode("utf-8")) % 78)
    r, g, b = colorsys.hls_to_rgb(hue / 360, 0.55, 0.28)
    return f"#{round(r*255):02X}{round(g*255):02X}{round(b*255):02X}"


def rule(end: float = 0.74) -> ft.Container:
    end = max(0.55, min(0.84, end))
    return ft.Container(height=1, gradient=ft.LinearGradient(
        begin=ft.alignment.center_left, end=ft.alignment.center_right,
        colors=[ft.Colors.TRANSPARENT, LINE, LINE, ft.Colors.TRANSPARENT],
        stops=[0.0, 0.06, end, 1.0],
    ))


def vrule(height: float) -> ft.Container:
    return ft.Container(width=1, height=height, gradient=ft.LinearGradient(
        begin=ft.alignment.top_center, end=ft.alignment.bottom_center,
        colors=[ft.Colors.TRANSPARENT, LINE_INPUT, LINE_INPUT, ft.Colors.TRANSPARENT],
        stops=[0.0, 0.28, 0.72, 1.0],
    ))


def eyebrow(text: str) -> ft.Text:
    return ft.Text(text.upper(), style=ft.TextStyle(size=11,
                   weight=ft.FontWeight.W_500, color=MUTED_2,
                   font_family=BODY_FONT, letter_spacing=1.76))


def display(text, size=56, color=TEXT_1, italic=False, **kw) -> ft.Text:
    return ft.Text(str(text), size=size * _text_scale, color=color,
                   font_family=DISPLAY_FONT_ITALIC if italic else DISPLAY_FONT,
                   weight=ft.FontWeight.W_300, **kw)


def numeral(value, size=34, color=TEXT_1) -> ft.Text:
    return display(value, size=size, color=color)


def body(text, size=15, color=TEXT_DIM, **kw) -> ft.Text:
    return ft.Text(str(text), size=size, color=color, font_family=BODY_FONT,
                   height=1.6, **kw)


def ui_text(text, size=13.5, color=MUTED, weight=None, **kw) -> ft.Text:
    return ft.Text(str(text), size=size, color=color, font_family=BODY_FONT,
                   weight=weight, **kw)


def caption(text, color=MUTED_2, size=12, **kw) -> ft.Text:
    return ui_text(text, size=size, color=color, **kw)


def mono_caption(text) -> ft.Text:
    return ft.Text(str(text).upper(), style=ft.TextStyle(size=9.5, color=FAINT,
                   font_family="monospace", letter_spacing=1.0))


def markdown_style(text_color: str = TEXT_DIM, size: float = 15) -> ft.MarkdownStyleSheet:
    base = ft.TextStyle(font_family=BODY_FONT, size=size, color=text_color, height=1.6)
    return ft.MarkdownStyleSheet(p_text_style=base, em_text_style=ft.TextStyle(
        font_family=DISPLAY_FONT_ITALIC, size=size, color=text_color))


def md(text: str, text_color: str = TEXT_DIM, size: float = 15, **kwargs) -> ft.Markdown:
    return ft.Markdown(text or "", selectable=True,
                       extension_set=ft.MarkdownExtensionSet.GITHUB_WEB,
                       md_style_sheet=markdown_style(text_color, size), **kwargs)


def hero_numeral(value, label: str, delta: str = "", delta_good=True) -> ft.Control:
    details = [caption(label)]
    if delta:
        details.append(ui_text(delta, color=GOOD if delta_good else BAD))
    return ft.Row([numeral(value, 92), ft.Column(details, spacing=5)], spacing=22,
                  vertical_alignment=ft.CrossAxisAlignment.END)


def fading_bar(fill: float, width: float | None = None, previous: float | None = None) -> ft.Control:
    fill = max(0.0, min(1.0, fill))
    stop = max(0.01, min(0.94, fill))
    return ft.Container(width=width, height=2, animate=ft.Animation(
        0 if _reduce_motion else 600, ft.AnimationCurve.EASE_OUT_CUBIC),
        gradient=ft.LinearGradient(begin=ft.alignment.center_left,
            end=ft.alignment.center_right,
            colors=[ft.Colors.with_opacity(.82, ACCENT),
                    ft.Colors.with_opacity(.82, ACCENT),
                    ft.Colors.with_opacity(.20, ACCENT), ft.Colors.TRANSPARENT],
            stops=[0, stop, min(.97, stop + .16), 1]))


def _action_text(label, color, size, family, weight, enabled, on_click, tooltip=None):
    text = ft.Text(label, size=size, color=color if enabled else FAINT,
                   font_family=family, weight=weight)
    control = ft.Container(text, on_click=on_click if enabled else None,
                           tooltip=tooltip, ink=False)
    control.on_hover = lambda e: _action_hover(e, text, color if enabled else FAINT)
    return control


def _action_hover(e, text, normal):
    text.color = TEXT_1 if e.data == "true" and normal != BAD else normal
    if text.page:
        text.update()


def text_action(label, on_click, size=34, sub: str = "", enabled=True) -> ft.Control:
    action = _action_text(label, ACCENT, size, DISPLAY_FONT, ft.FontWeight.W_300,
                          enabled, on_click)
    action.content = ft.Column([action.content, ft.Container(height=1, gradient=ft.LinearGradient(
        begin=ft.alignment.center_left, end=ft.alignment.center_right,
        colors=[ft.Colors.TRANSPARENT, ACCENT, ft.Colors.with_opacity(.25, ACCENT)],
        stops=[0, .78, 1]))] + ([caption(sub)] if sub else []), spacing=9, tight=True)
    return action


def secondary_action(label, on_click, tooltip=None) -> ft.Control:
    return _action_text(label, MUTED, 13.5, BODY_FONT, None, True, on_click, tooltip)


def destructive_action(label, on_click) -> ft.Control:
    return _action_text(label, BAD, 13.5, BODY_FONT, None, True, on_click)


def text_tabs(items: list[str], selected: str, on_select, neutral=False) -> ft.Row:
    controls = []
    for item in items:
        active = item == selected
        label = ui_text(item, size=14.5, color=TEXT_1 if active else MUTED,
                        weight=ft.FontWeight.W_600 if active else None)
        underline = ft.Container(height=1, width=max(28, len(item) * 7),
            gradient=ft.LinearGradient(begin=ft.alignment.center_left,
                end=ft.alignment.center_right,
                colors=[LINE if neutral else ACCENT, ft.Colors.TRANSPARENT]))
        controls.append(ft.Container(ft.Column([label, underline if active else ft.Container(height=1)],
                                               spacing=7, tight=True),
                                     on_click=lambda e, x=item: on_select(x)))
    return ft.Row(controls, spacing=28, tight=True)


class UnderlinedField(ft.Column):
    def __init__(self, label: str, value: str = "", hint: str = "", multiline=False,
                 lines=1, max_lines=None, password=False, can_reveal_password=False, width=None,
                 on_change=None, on_submit=None, autofocus=False, **kwargs):
        kwargs.pop("accent", None)
        kwargs.pop("text_size", None)
        self.text_field = ft.TextField(value=value, hint_text=hint, multiline=multiline,
            min_lines=lines if multiline else 1,
            max_lines=max_lines if multiline else 1,
            password=password, can_reveal_password=can_reveal_password,
            border=ft.InputBorder.NONE, filled=False, bgcolor=ft.Colors.TRANSPARENT,
            content_padding=ft.padding.symmetric(vertical=5), text_size=16,
            text_style=ft.TextStyle(font_family=BODY_FONT, color=TEXT_1, height=1.5),
            hint_style=ft.TextStyle(font_family=BODY_FONT, color=MUTED_2),
            on_change=on_change, on_submit=on_submit, autofocus=autofocus, **kwargs)
        self._line = ft.Container(height=1, bgcolor=LINE_INPUT)
        self.text_field.on_focus = self._focus
        self.text_field.on_blur = self._blur
        super().__init__([eyebrow(label), self.text_field, self._line], spacing=2,
                         tight=True, width=width)

    @property
    def value(self): return self.text_field.value or ""
    @value.setter
    def value(self, value): self.text_field.value = value
    def focus(self): return self.text_field.focus()
    def _focus(self, e):
        self._line.bgcolor = ACCENT
        if self._line.page: self._line.update()
    def _blur(self, e):
        self._line.bgcolor = LINE_INPUT
        if self._line.page: self._line.update()


def select_row(label, value, options: list[tuple[str, str]], on_select) -> ft.Control:
    shown = next((name for key, name in options if key == value), value or "Choose")
    pop = ft.PopupMenuButton(content=ui_text(f"{shown}  ⌄", color=TEXT_1, size=16),
        items=[ft.PopupMenuItem(text=name, on_click=lambda e, k=key: on_select(k))
               for key, name in options], menu_position=ft.PopupMenuPosition.UNDER)
    return ft.Column([eyebrow(label), pop, ft.Container(height=1, bgcolor=LINE_INPUT)],
                     spacing=6, tight=True)


def _hatch(width, height, caption_text):
    return ft.Container(width=width, height=height, alignment=ft.alignment.center,
        gradient=ft.LinearGradient(begin=ft.alignment.top_left,
            end=ft.alignment.bottom_right,
            colors=[ft.Colors.with_opacity(.04, TEXT_1), ft.Colors.TRANSPARENT,
                    ft.Colors.with_opacity(.04, TEXT_1)]),
        content=mono_caption(caption_text))


def masked_art(src, width=None, height=None, aspect=None, fit=ft.ImageFit.CONTAIN,
               align=None, mask=(0.5, 0.0, -0.16, 0.26, 0.72),
               hatch_caption: str = "no art") -> ft.Control:
    if aspect and width and not height: height = width / aspect
    if not src: return _hatch(width, height, hatch_caption)
    # The mask is only an edge feather.  Earlier values used a sub-0.5 radius,
    # which reduced wide and tall assets to a small circular peephole.
    _, cx, cy, _, _ = mask
    radius, solid, fade = 1.16, .80, 1.0
    image = ft.Image(src=src, width=width, height=height, fit=fit,
                     filter_quality=ft.FilterQuality.HIGH)
    return ft.ShaderMask(content=image, blend_mode=ft.BlendMode.DST_IN,
        shader=ft.RadialGradient(center=ft.alignment.Alignment(cx, cy), radius=radius,
            colors=[ft.Colors.BLACK, ft.Colors.BLACK, ft.Colors.TRANSPARENT],
            stops=[0, solid, fade]))


def portrait(src, tint: str, width, height, ghost=False, floor_fade=True,
             glow=True) -> tuple[ft.Control, ft.Container]:
    glow_layer = ft.Container(width=width, height=height, opacity=0 if not glow else .55,
        gradient=ft.RadialGradient(center=ft.alignment.Alignment(0, -.08), radius=1.05,
            colors=[ft.Colors.with_opacity(.45, tint), ft.Colors.TRANSPARENT],
            stops=[0, 1]))
    # Character art in the current asset library generally has real alpha.  Do
    # not run it through the backdrop shader mask: doing so erases transparent
    # edges and can reduce wide sprites to a radial peephole.
    art = (ft.Image(src=src, width=width, height=height, fit=ft.ImageFit.CONTAIN,
                    filter_quality=ft.FilterQuality.HIGH)
           if src else _hatch(width, height, "no portrait"))
    art.opacity = .42 if ghost else 1
    layers = [glow_layer, art]
    if floor_fade and not src:
        layers.append(ft.Container(width=width, height=height,
            gradient=ft.RadialGradient(center=ft.alignment.Alignment(0, 0), radius=1.12,
                colors=[ft.Colors.TRANSPARENT, ft.Colors.TRANSPARENT, BG],
                stops=[0, .84, 1])))
    tile = ft.Stack(layers, width=width, height=height, clip_behavior=ft.ClipBehavior.NONE)
    return tile, glow_layer


def character_tile(src: str, width=None, height=None, ghost=False) -> ft.Control:
    """A transparent, uncropped 16:9 character selection image."""
    if not src:
        return _hatch(width, height, "no shelf art")
    image = ft.Image(src=src, width=width, height=height, fit=ft.ImageFit.CONTAIN,
                     filter_quality=ft.FilterQuality.HIGH)
    image.opacity = .42 if ghost else 1
    return image


def compact(page) -> bool:
    """Whether the current viewport needs the compact composition."""
    return float(getattr(page, "width", 1280) or 1280) < 1120 or \
        float(getattr(page, "height", 820) or 820) < 720


def gutter(page) -> int:
    return 24 if compact(page) else 52


def responsive_grid(controls: list[ft.Control], item_width=236, item_height=176,
                    spacing=24, expand=True) -> ft.GridView:
    """A reachable vertical grid for browse/select collections."""
    return ft.GridView(controls=controls, expand=expand, max_extent=item_width,
                       child_aspect_ratio=item_width / item_height,
                       spacing=spacing, run_spacing=spacing,
                       padding=ft.padding.only(right=8))


def scrim_top(stop=0.34) -> ft.LinearGradient:
    return ft.LinearGradient(begin=ft.alignment.top_center, end=ft.alignment.bottom_center,
        colors=[ft.Colors.with_opacity(.58, BG), ft.Colors.TRANSPARENT,
                ft.Colors.with_opacity(.62, BG)],
        stops=[0, stop, 1])


def scrim_side(direction="right") -> ft.LinearGradient:
    begin, end = (ft.alignment.center_left, ft.alignment.center_right)
    if direction == "left": begin, end = end, begin
    return ft.LinearGradient(begin=begin, end=end,
        colors=[ft.Colors.with_opacity(.82, BG), ft.Colors.with_opacity(.42, BG),
                ft.Colors.TRANSPARENT],
        stops=[.08, .48, .92])


def disclosure(label: str, rows: list[tuple[str, str]]) -> ft.Control:
    contents = ft.Column([], spacing=10, visible=False)
    def toggle(e):
        contents.visible = not contents.visible
        head.content.value = label + ("  ⌃" if contents.visible else "  ⌄")
        head.update(); contents.update()
    head = secondary_action(label + "  ⌄", toggle)
    for index, (name, value) in enumerate(rows):
        contents.controls.extend([ft.Row([ui_text(name), ft.Container(expand=True),
                                          caption(value)]), rule(.58 + (index % 4) * .07)])
    return ft.Column([head, contents], spacing=14, tight=True)


def dot_path(items: list[tuple[str, str, str]], selected: int, on_select) -> ft.Control:
    cells = []
    for index, (label, status, status_text) in enumerate(items):
        current = index == selected
        dot = ft.Container(width=14 if current else 12, height=14 if current else 12,
            border=None if status == "written" or current else ft.border.all(1, BAD),
            bgcolor=ACCENT if current else ft.Colors.with_opacity(.5, TEXT_1)
                    if status == "written" else ft.Colors.TRANSPARENT,
            border_radius=7)
        cells.append(ft.Container(ft.Column([dot, display(label, 15,
            TEXT_1 if current else TEXT_DIM), caption(status_text,
            ACCENT if current else MUTED_2)], horizontal_alignment=ft.CrossAxisAlignment.CENTER,
            spacing=5, tight=True), on_click=lambda e, i=index: on_select(i), expand=True))
    return ft.Stack([ft.Container(top=6, left=10, right=10, content=rule(.82)),
                     ft.Row(cells, spacing=8)], height=76)


def verdict(spans: list[tuple[str, str | None]]) -> ft.Control:
    return ft.Text(spans=[ft.TextSpan(text, ft.TextStyle(
        font_family=BODY_FONT, size=16, color=color or TEXT_DIM, height=1.6))
        for text, color in spans])


async def pulse(control, lo=0.35, hi=0.9, half=1.4) -> None:
    if _reduce_motion: return
    control.animate_opacity = ft.Animation(int(half * 1000), ft.AnimationCurve.EASE_IN_OUT)
    while control.page:
        for value in (hi, lo):
            if not control.page: return
            control.opacity = value
            control.update()
            await asyncio.sleep(half)


def pulse_dot(page, label: str = "", color=ACCENT) -> ft.Control:
    dot = ft.Container(width=7, height=7, border_radius=4, bgcolor=color, opacity=.9,
                       shadow=ft.BoxShadow(blur_radius=10,
                           color=ft.Colors.with_opacity(.8, color)))
    row = ft.Row([dot] + ([caption(label, color=color)] if label else []), spacing=8, tight=True)
    if not _reduce_motion and hasattr(page, "run_task"):
        try: page.run_task(pulse, dot)
        except Exception: pass
    return row


def screen(page, route, body=None, back_label=None, back_route=None,
           right_actions: list[ft.Control] | None = None,
           backdrop: ft.Control | None = None, **legacy) -> ft.View:
    body = body or legacy.get("body_control")
    right_actions = right_actions if right_actions is not None else legacy.get("actions", [])
    back_route = back_route or legacy.get("back_route")
    top = []
    if back_route:
        top.append(secondary_action(f"← {back_label or 'Worlds'}", lambda e: page.go(back_route)))
    else:
        top.append(eyebrow("Character Chat"))
    top.extend([ft.Container(expand=True), *(right_actions or [])])
    content = ft.Column([ft.Row(top, spacing=24), ft.Container(height=30),
                         ft.Container(body, expand=True)], expand=True, spacing=0)
    inner = ft.Container(content, padding=gutter(page), expand=True)
    layers = ([backdrop] if backdrop else []) + [inner]
    switcher = ft.AnimatedSwitcher(ft.Stack(layers, expand=True),
        duration=0 if _reduce_motion else 180,
        transition=ft.AnimatedSwitcherTransition.FADE)
    return ft.View(route=route, controls=[switcher], bgcolor=BG, padding=0)


def overlay(page, title, content, actions, eyebrow_text="") -> None:
    previous_keyboard = getattr(page, "on_keyboard_event", None)
    shell = ft.Container(expand=True, bgcolor=BG, padding=gutter(page))
    def close(_=None):
        if shell in page.overlay: page.overlay.remove(shell)
        page.on_keyboard_event = previous_keyboard
        page.update()
    def keyboard(e):
        if e.key == "Escape": close()
    normalized = []
    for action in actions:
        if isinstance(action, tuple):
            label, handler = action
            normalized.append(secondary_action(label, handler))
        else: normalized.append(action)
    shell.content = ft.Column([
        eyebrow(eyebrow_text or "Character Chat"), rule(.74),
        display(title, 52), ft.Container(height=12),
        ft.Container(content=ft.Column([content], scroll=ft.ScrollMode.AUTO,
                                      expand=True), expand=True), rule(.68),
        ft.Row([*normalized, ft.Container(expand=True), secondary_action("Close", close)], spacing=28),
    ], expand=True, spacing=18)
    page.overlay.append(shell); page.on_keyboard_event = keyboard; page.update()


def snack(page, message, error=False) -> None:
    page.open(ft.SnackBar(body(message, 13.5, TEXT_1),
                          bgcolor=BAD if error else BG2, elevation=0))
