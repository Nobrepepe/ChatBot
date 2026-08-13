"""Route parsing and view stack management.

Routes:
    /                                        home (world list)
    /settings                                provider settings
    /personas                                user persona management
    /world/new                               new world editor
    /world/{wid}                             world editor
    /world/{wid}/characters                  world editor, Characters tab
    /world/{wid}/notes-list                  world editor, Notes tab
    /world/{wid}/character/new               new character editor
    /world/{wid}/character/{cid}             character editor
    /world/{wid}/character/{cid}/memories    memory screen
    /world/{wid}/scene/new                   scene setup
    /world/{wid}/notes                       notes workspace (AI assistant)
    /chat/{scene_id}                         visual novel chat

On every route change the whole ancestor stack is rebuilt so the back
button always leads somewhere sensible.
"""

import flet as ft

from .. import repository as repo


def _build_views(page: ft.Page, route: str) -> list[ft.View]:
    # Imported lazily to avoid circular imports at module load.
    from .character_view import character_view
    from .chat_view import chat_view
    from .home_view import home_view
    from .memory_view import memory_view
    from .notes_view import notes_workspace_view
    from .persona_view import persona_view
    from .scene_setup_view import scene_setup_view
    from .settings_view import settings_view
    from .world_view import world_view

    parts = [p for p in route.split("/") if p]
    views: list[ft.View] = [home_view(page)]

    if not parts:
        return views

    if parts[0] == "settings":
        views.append(settings_view(page))
        return views

    if parts[0] == "personas":
        views.append(persona_view(page))
        return views

    if parts[0] == "world":
        wid = None if parts[1] == "new" else int(parts[1])
        world_tabs = {"characters", "sessions", "lorebook", "notes-list"}
        initial_tab = parts[2] if len(parts) > 2 and parts[2] in world_tabs else "world"
        views.append(world_view(page, wid, initial_tab))
        if wid is None or len(parts) < 3:
            return views
        if parts[2] in world_tabs:
            return views
        if parts[2] == "character":
            cid = None if parts[3] == "new" else int(parts[3])
            views.append(character_view(page, wid, cid))
            if cid is not None and len(parts) > 4 and parts[4] == "memories":
                views.append(memory_view(page, wid, cid))
        elif parts[2] == "scene":
            template_id = int(parts[4]) if len(parts) > 4 and parts[3] == "new" and parts[4].isdigit() else None
            views.append(scene_setup_view(page, wid, template_id))
        elif parts[2] == "notes":
            views.append(notes_workspace_view(page, wid))
        return views

    if parts[0] == "chat":
        scene_id = int(parts[1])
        scene = repo.get_scene(scene_id)
        if scene:
            views.append(world_view(page, scene.world_id))
            views.append(chat_view(page, scene_id))
        return views

    return views


def route_change(e: ft.RouteChangeEvent) -> None:
    page = e.page
    # View-scoped shortcuts and resize handlers must not leak into the next view.
    page.on_keyboard_event = None
    page.on_resized = None
    page.views.clear()
    try:
        for v in _build_views(page, e.route):
            page.views.append(v)
    except Exception as exc:  # bad id in route, deleted entity, etc.
        page.views.clear()
        from .home_view import home_view

        page.views.append(home_view(page))
        from . import theme as th
        th.snack(page, f"Could not open page: {exc}", error=True)
    page.update()


def view_pop(e) -> None:
    page = e.page
    if len(page.views) > 1:
        page.views.pop()
        page.go(page.views[-1].route)
