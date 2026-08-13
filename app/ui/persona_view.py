"""Persona management as a quiet list with full-frame editors."""

import flet as ft
from .. import repository as repo
from ..models import Persona
from . import theme as th


def persona_view(page: ft.Page) -> ft.View:
    listing = ft.ListView(spacing=0, expand=True, padding=0)

    def edit(persona: Persona | None = None):
        item = persona or Persona()
        name = th.UnderlinedField("Persona name", item.name,
            hint="The name characters use for you")
        description = th.UnderlinedField("Description", item.description,
            hint="Role, appearance, history, and how the cast should perceive you",
            multiline=True, lines=7)
        def save(e):
            if not name.value.strip():
                th.snack(page, "A persona needs a name.", True); return
            item.name, item.description = name.value.strip(), description.value.strip()
            repo.save_persona(item); close_overlay(); refresh()
        def close_overlay():
            if page.overlay: page.overlay.pop(); page.update()
        th.overlay(page, "Who are you in the scene?", ft.Column([
            th.body("This description is sent with scenes that choose this persona."),
            ft.Container(height=20), name, ft.Container(height=18), description], spacing=0),
            [th.text_action("Save the persona →", save)], eyebrow_text="Persona")

    def remove(item):
        def confirm(e):
            repo.delete_persona(item.id)
            if page.overlay: page.overlay.pop()
            refresh(); page.update()
        th.overlay(page, f"Delete {item.name}?", th.body(
            "Scenes that use this persona will fall back to plain ‘you’. Their conversations remain intact."),
            [th.destructive_action(f"Delete {item.name}", confirm)], eyebrow_text="Confirmation")

    def refresh():
        listing.controls.clear()
        items = repo.list_personas()
        if not items:
            listing.controls.append(th.body(
                "No personas yet. Without one, characters address you simply as ‘you’."))
        for index, item in enumerate(items):
            listing.controls.extend([ft.Container(ft.Row([
                ft.Column([th.display(item.name, 23),
                    th.body(item.description or "No description yet.", 13.5,
                            max_lines=2, overflow=ft.TextOverflow.ELLIPSIS)],
                    spacing=3, expand=True),
                th.secondary_action("Edit", lambda e, x=item: edit(x)),
                th.destructive_action("Delete", lambda e, x=item: remove(x)),
            ], spacing=24), padding=ft.padding.symmetric(vertical=14),
            on_click=lambda e, x=item: edit(x)), th.rule(.58 + index % 4 * .07)])
        if listing.page: listing.update()

    refresh()
    count = len(repo.list_personas())
    headline = (f"{count} ways to enter a scene." if count != 1
                else "One way to enter a scene." if count else
                "You can enter as yourself, or name someone new.")
    body = ft.Column([th.eyebrow("Personas"), ft.Container(height=10),
        th.display(headline, 62, max_lines=2), ft.Container(height=12),
        th.body("A scene may choose one persona. Its description becomes part of what the cast knows about you."),
        ft.Container(height=36), ft.Row([th.eyebrow("Who you can be"),
            ft.Container(expand=True), th.secondary_action("New persona →", lambda e: edit())]),
        ft.Container(height=8), listing], spacing=0, expand=True)
    return th.screen(page, "/personas", body, back_route="/", back_label="Worlds")
