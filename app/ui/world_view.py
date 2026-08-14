"""World workspace: one subject, five quiet sections."""

import flet as ft
from .. import repository as repo
from ..models import LoreEntry, World
from ..services.asset_service import import_session_background, import_world_cover
from . import theme as th

TABS = ["World", "Characters", "Sessions", "Lorebook", "Notes"]


def world_view(page: ft.Page, world_id: int | None, initial_tab: str = "world") -> ft.View:
    world = repo.get_world(world_id) if world_id else World()
    if world_id and not world: raise ValueError("World not found")
    is_new = world.id is None
    hub_managed = bool(getattr(world, "hub_id", None))
    mapped = {"world":"World", "characters":"Characters", "sessions":"Sessions",
              "lorebook":"Lorebook", "notes-list":"Notes"}
    state = {"tab": mapped.get(initial_tab, "World"), "detail": "Identity"}
    host = ft.Container(expand=True)
    name = th.UnderlinedField("World name", world.name)
    genre = th.UnderlinedField("Genre", world.genre)
    tone = th.UnderlinedField("Tone", world.tone)
    summary = th.UnderlinedField("Short summary", world.summary, multiline=True, lines=3)
    setting = th.UnderlinedField("Setting description", world.setting_description, multiline=True, lines=6)
    style = th.UnderlinedField("Style guide", world.style_guide, multiline=True, lines=6)
    if hub_managed:
        for field in (name, genre, tone, summary, setting, style):
            field.read_only = True

    def save_world(e=None):
        if not name.value.strip(): th.snack(page, "A world needs a name.", True); return
        world.name, world.genre, world.tone = name.value.strip(), genre.value.strip(), tone.value.strip()
        world.summary, world.setting_description, world.style_guide = summary.value.strip(), setting.value.strip(), style.value.strip()
        new_id = repo.save_world(world); world.id = new_id
        th.snack(page, "World saved.")
        if is_new: page.go(f"/world/{new_id}")

    def pick_art(kind):
        def result(e):
            if not e.files: return
            path = e.files[0].path
            if kind == "cover": world.cover_image_path = import_world_cover(path, name.value or world.name or "world")
            else: world.session_background_path = import_session_background(path, name.value or world.name or "world")
            save_world(); render()
        picker = ft.FilePicker(on_result=result); page.overlay.append(picker); page.update()
        picker.pick_files(allow_multiple=False, allowed_extensions=["png","jpg","jpeg","webp"])

    def confirm_delete(label, message, action):
        def run(e):
            action()
            if page.overlay: page.overlay.pop()
            page.update()
        th.overlay(page, label, th.body(message), [th.destructive_action(label, run)], "Confirmation")

    def detail_content():
        if state["detail"] == "Identity":
            return ft.Column([ft.Row([ft.Container(name, expand=2), ft.Container(genre, expand=1), ft.Container(tone, expand=1)], spacing=28),
                ft.Container(height=22), summary], spacing=0)
        if state["detail"] == "Setting":
            return ft.Row([ft.Container(setting, expand=True), ft.Container(width=60), ft.Container(style, expand=True)],
                          vertical_alignment=ft.CrossAxisAlignment.START)
        return ft.Row([art_block("World cover", world.cover_image_path, "Import a world cover", "cover"),
                       ft.Container(width=70),
                       art_block("Scene fallback", world.session_background_path,
                                 "Import scene art", "scene")],
                      vertical_alignment=ft.CrossAxisAlignment.START)

    def art_block(label, path, action, kind):
        return ft.Column([th.eyebrow(label), ft.Container(height=10),
            th.masked_art(path, 470, 264, hatch_caption="no art"), ft.Container(height=10),
            *([] if hub_managed else [th.secondary_action(action, lambda e: pick_art(kind))])], spacing=0, expand=True)

    def details_tab():
        return ft.Column([th.text_tabs(["Identity","Setting","Art"], state["detail"],
            lambda x: (state.__setitem__("detail", x), render())), ft.Container(height=24),
            detail_content(), ft.Container(expand=True), th.rule(.74), ft.Container(height=18),
            (th.caption("This world comes from a World Hub publication and is read-only here. "
                        "Updates arrive through Settings → World Hub content.") if hub_managed else
             ft.Row([th.text_action("Save the world →", save_world, size=30), ft.Container(expand=True),
                *([] if is_new else [th.destructive_action(f"Delete {world.name}", lambda e: confirm_delete(
                    f"Delete {world.name}", "Its characters, scenes, chats, lore and memories will be removed.",
                    lambda: (repo.delete_world(world.id), page.go("/"))))])]))], expand=True, spacing=0)

    def characters_tab():
        chars = repo.list_characters(world.id) if world.id else []
        shelf = []
        for index, char in enumerate(chars):
            ghost = not bool(char.summary or char.personality)
            if char.tile_image_path:
                tile = th.character_tile(char.tile_image_path, 236, 133, ghost)
            else:
                tile, _ = th.portrait(char.portrait_path,
                    th.character_color(char), 236, 133, ghost=ghost)
            shelf.append(ft.Container(ft.Column([tile, th.display(char.name or "Untitled", 22),
                th.caption(char.role or "Profile empty")], spacing=4), width=236,
                margin=ft.margin.only(top=8 if index % 2 else 0),
                on_click=lambda e, cid=char.id: page.go(f"/world/{world.id}/character/{cid}")))
        if not shelf:
            return ft.Column([ft.Row([th.eyebrow("The cast"), ft.Container(expand=True),
                th.secondary_action("New character →", lambda e: page.go(f"/world/{world.id}/character/new"))]),
                ft.Container(height=18), th.body("No one lives here yet. A character’s profile becomes the voice the model follows.")],
                expand=True, spacing=0)
        return ft.Column([ft.Row([th.eyebrow("The cast"), ft.Container(expand=True),
            th.secondary_action("New character →", lambda e: page.go(f"/world/{world.id}/character/new"))]),
            ft.Container(height=18), th.responsive_grid(shelf, 252, 190)], expand=True, spacing=0)

    def sessions_tab():
        scenes = repo.list_scenes(world.id) if world.id else []
        templates = repo.list_scene_templates(world.id) if world.id else []
        rows=[]
        for i, scene in enumerate(scenes):
            chars=[repo.get_character(cid) for cid in scene.character_ids]
            names=", ".join(c.name for c in chars if c)
            rows.extend([ft.Container(ft.Row([ft.Column([th.display(scene.title or "Untitled scene", 23),
                th.caption(f"{names} · {repo.count_messages(scene.id)} messages · {scene.updated_at or scene.created_at}")], spacing=3, expand=True),
                th.secondary_action("Open scene →", lambda e, sid=scene.id: page.go(f"/chat/{sid}")),
                th.destructive_action("Delete", lambda e, s=scene: confirm_delete("Delete this scene",
                    "Its transcript will be removed. Character memories remain.", lambda: (repo.delete_scene(s.id), render())))], spacing=22),
                padding=ft.padding.symmetric(vertical=12)), th.rule(.56+i%4*.08)])
        if not rows: rows.append(th.caption("No scenes yet."))
        template_rows=[]
        for i,item in enumerate(templates):
            template_rows.extend([ft.Row([th.display(item.name or "Untitled setup",20),ft.Container(expand=True),
                th.secondary_action("Use setup →",lambda e,tid=item.id:page.go(f"/world/{world.id}/scene/new/{tid}")),
                th.destructive_action("Delete",lambda e,x=item:confirm_delete("Delete this setup",
                    "Existing scenes will not change.",lambda:(repo.delete_scene_template(x.id),render())))],spacing=20),th.rule(.58+i%4*.07)])
        content=[ft.Row([th.eyebrow("Scenes"),ft.Container(expand=True),
            th.text_action("Start a new scene →",lambda e:page.go(f"/world/{world.id}/scene/new"),size=30)]),
            ft.Container(height=8), *rows]
        if templates:content.extend([ft.Container(height=20),th.eyebrow("Saved setups"),ft.Container(height=8),*template_rows])
        return ft.ListView(content, spacing=0, expand=True, padding=0)

    def lore_editor(entry=None):
        item=entry or LoreEntry(world_id=world.id)
        title=th.UnderlinedField("Title", item.title); content=th.UnderlinedField("Lore", item.content, multiline=True, lines=7)
        keys=th.UnderlinedField("Trigger keywords", item.keywords)
        always = {"value":item.always_include}
        def choose_always(value):always["value"]=value=="Always"
        def save(e):
            item.title, item.content, item.keywords = title.value.strip(), content.value.strip(), keys.value.strip()
            item.always_include=always["value"]; repo.save_lore_entry(item)
            if page.overlay: page.overlay.pop()
            render(); page.update()
        include=th.select_row("Inclusion","Always" if always["value"] else "By keyword",
            [("By keyword","By keyword"),("Always","Always")],choose_always)
        th.overlay(page, "What should this world remember?", ft.Column([title, content, keys,include,
            th.caption("Leave keywords empty only for lore that should always be included.")], spacing=18),
            [th.text_action("Save the lore →", save)], "Lorebook entry")

    def lore_tab():
        entries=repo.list_lore_entries(world.id) if world.id else []
        always=sum(1 for x in entries if x.always_include)
        rows=[]
        for i,item in enumerate(entries):
            rows.extend([ft.Container(ft.Row([ft.Column([th.display(item.title or "Untitled",22),
                th.caption("Always included" if item.always_include else f"Triggered by {item.keywords or 'no keywords'}")], spacing=3, expand=True),
                *([] if hub_managed else [th.secondary_action("Edit", lambda e,x=item:lore_editor(x)),
                th.destructive_action("Delete", lambda e,x=item:confirm_delete("Delete this lore entry",
                    "It will stop appearing in future prompts.", lambda:(repo.delete_lore_entry(x.id),render())))])], spacing=24),
                padding=ft.padding.symmetric(vertical=11)), th.rule(.58+i%4*.07)])
        if not rows: rows.append(th.body("Nothing is in the lorebook yet."))
        return ft.ListView([ft.Row([th.numeral(len(entries),46), th.body(f"entries; {always} always included and {len(entries)-always} waiting for keywords."),
            ft.Container(expand=True), *([] if hub_managed else [th.secondary_action("New lore entry →", lambda e:lore_editor())])]),
            ft.Container(height=18), *rows], spacing=0, expand=True, padding=0)

    def notes_tab():
        from .notes_view import standalone_notes_panel
        return ft.Column([
            ft.Row([th.eyebrow("Private notes — never sent in scene prompts"),
                    ft.Container(expand=True),
                    th.secondary_action("Open the AI workspace →", lambda e: page.go(f"/world/{world.id}/notes"))]),
            ft.Container(height=16), standalone_notes_panel(page, world.id),
        ], spacing=0, expand=True)

    def render():
        builders={"World":details_tab,"Characters":characters_tab,"Sessions":sessions_tab,
                  "Lorebook":lore_tab,"Notes":notes_tab}
        host.content=builders[state["tab"]]()
        if host.page:host.update()
    def choose_tab(value):state["tab"]=value;render()
    render()
    chars=len(repo.list_characters(world.id)) if world.id else 0
    scenes=len(repo.list_scenes(world.id)) if world.id else 0
    backdrop=None
    if world.cover_image_path:
        backdrop=ft.Stack([
            ft.Image(src=world.cover_image_path, fit=ft.ImageFit.COVER,
                     opacity=.28, expand=True,
                     filter_quality=ft.FilterQuality.HIGH),
            ft.Container(expand=True, gradient=ft.LinearGradient(
                begin=ft.alignment.top_center, end=ft.alignment.bottom_center,
                colors=[ft.Colors.with_opacity(.38, th.BG),
                        ft.Colors.with_opacity(.68, th.BG), th.BG],
                stops=[0, .58, 1])),
            ft.Container(expand=True,gradient=th.scrim_side())],expand=True)
    body=ft.Column([ft.Row([th.display(world.name or "New world",36),ft.Container(expand=True),
        th.text_tabs(TABS,state["tab"],choose_tab)]),ft.Container(height=20),host],spacing=0,expand=True)
    return th.screen(page,f"/world/{world.id or 'new'}",body,back_route="/",back_label="Worlds",
        right_actions=[th.secondary_action("Personas",lambda e:page.go("/personas")),
                       th.secondary_action("Settings",lambda e:page.go("/settings"))],backdrop=backdrop)
