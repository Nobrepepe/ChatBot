"""Home: the most recent scene and the worlds waiting behind it."""

from datetime import datetime
import flet as ft

from .. import repository as repo
from . import theme as th


def _date(value: str) -> str:
    if not value: return "not opened yet"
    try:
        days = (datetime.now() - datetime.fromisoformat(value)).days
    except ValueError: return value
    return "today" if days == 0 else "yesterday" if days == 1 else f"{days} days ago"


def home_view(page: ft.Page) -> ft.View:
    worlds = repo.list_worlds()
    settings = repo.get_settings()
    try: history_limit = max(1, int(settings.get("history_limit", "30")))
    except ValueError: history_limit = 30
    scenes = [(scene, world) for world in worlds for scene in repo.list_scenes(world.id)]
    scenes.sort(key=lambda pair: pair[0].updated_at or pair[0].created_at, reverse=True)
    recent = scenes[0] if scenes else None

    if recent:
        scene, active_world = recent
        messages = repo.count_messages(scene.id)
        sent = min(messages, history_limit)
        outside = max(0, messages - sent)
        chars = [repo.get_character(cid) for cid in scene.character_ids]
        names = ", ".join(c.name for c in chars if c)
        destination = scene.title or "the scene"
        headline = f"{active_world.name} is still mid-scene."
        intro = f"{names or 'The cast'} last spoke {_date(scene.updated_at)}. Nothing has moved since."
        memory_line = (f"The history window carries all {messages} messages."
                       if not outside else
                       f"The history window carries the last {sent}. {outside} now fall outside it — summarize the scene and they return as one remembered line.")
        resume = ft.Column([
            th.eyebrow("Where you left off"), ft.Container(height=10),
            th.hero_numeral(messages, "messages in this scene"),
            ft.Container(height=12), th.fading_bar(sent / max(messages, 1), 520),
            ft.Container(height=10), th.body(memory_line), ft.Container(height=22),
            th.rule(.62), ft.Container(height=20),
            th.text_action(f"Return to {destination} →",
                lambda e: page.go(f"/chat/{scene.id}"), sub=f"{scene.mode.title()} · {names} · {'summarized' if scene.summary else 'nothing summarized yet'}"),
        ], spacing=0, expand=True)
        art = active_world.cover_image_path
    else:
        active_world = worlds[0] if worlds else None
        headline = (f"{active_world.name} is waiting for its first scene."
                    if active_world else
                    "Nothing started yet — make a world and it will wait for you there.")
        intro = ("Choose a character and a place when you are ready."
                 if active_world else "A world holds its characters, places, lore and conversations.")
        resume = ft.Column([th.eyebrow("Where you begin"), ft.Container(height=16),
            th.body("No conversation is in progress. The first scene will appear here with exactly how much of it the model remembers."),
            ft.Container(height=24), th.text_action("Make a world →", lambda e: page.go("/world/new"))], spacing=0)
        art = active_world.cover_image_path if active_world else ""

    rows = []
    for index, world in enumerate(worlds):
        world_scenes = repo.list_scenes(world.id)
        last = world_scenes[0].updated_at if world_scenes else ""
        thumb = th.masked_art(world.cover_image_path, 118, 66, hatch_caption="no art")
        row = ft.Container(ft.Row([thumb, ft.Column([
            th.display(world.name or "Untitled world", 23),
            th.caption(f"{len(repo.list_characters(world.id))} characters · {len(world_scenes)} sessions · {_date(last)}")
        ], spacing=3, expand=True)], spacing=20),
            padding=ft.padding.symmetric(vertical=10),
            on_click=lambda e, wid=world.id: page.go(f"/world/{wid}"))
        rows.extend([row, th.rule(.56 + (index % 4) * .08)])
    if not rows: rows.append(th.body("No worlds yet. The first one will wait here when you make it."))
    worlds_thread = ft.Column([ft.Row([th.eyebrow("Your worlds"), ft.Container(expand=True),
        th.secondary_action("New world →", lambda e: page.go("/world/new"))]),
        ft.ListView(rows,spacing=5,expand=True,padding=0)], spacing=5, expand=True,
        # A ListView needs a bounded axis. Desktop rows do not otherwise give
        # this side column a reliable vertical bound.
        height=None if th.compact(page) else max(300, float(getattr(page, "height", 820) or 820) - 300))

    backdrop = None
    if art:
        backdrop = ft.Stack([ft.Container(right=-280, top=-230,
            content=th.masked_art(art, 1280, 720, mask=(.62, 0, -.15, .28, .78))),
            ft.Container(expand=True, gradient=th.scrim_top()),
            ft.Container(expand=True, gradient=th.scrim_side())], expand=True)
    threads=(ft.Column([resume,ft.Container(height=30),ft.Container(worlds_thread,height=360)],spacing=0)
             if th.compact(page) else ft.Row([ft.Container(resume, width=600), ft.Container(width=70), worlds_thread],
               expand=True, vertical_alignment=ft.CrossAxisAlignment.START))
    content=ft.Column([th.display(headline, 62, max_lines=2), ft.Container(height=10),
        th.body(intro, max_lines=2), ft.Container(height=32),
        threads], expand=True, spacing=0)
    # The compact composition has its own page scroll. On desktop the worlds
    # thread must receive a bounded, expanding height so its ListView can own
    # overflow instead of letting later worlds fall below the viewport.
    body=(ft.ListView([content],expand=True,padding=0) if th.compact(page) else
          ft.Column([content], expand=True, spacing=0))
    return th.screen(page, "/", body, right_actions=[
        th.secondary_action("Personas", lambda e: page.go("/personas")),
        th.secondary_action("Settings", lambda e: page.go("/settings"))], backdrop=backdrop)
