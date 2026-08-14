"""Character profile editor: one section at a time along a dot path."""

import re
import flet as ft
from .. import repository as repo
from ..models import Character, CharacterSprite
from ..services.asset_service import import_portrait, import_character_tile
from . import theme as th

SECTIONS = [
    ("Appearance","appearance"),("Personality","personality"),("Backstory","backstory"),
    ("Behaviour","behavior_rules"),("Voice","voice_style"),
    ("Relationship","relationship_to_user"),("Instructions","ai_instructions"),("Sprites","sprites")]


def character_view(page: ft.Page, world_id: int, character_id: int | None) -> ft.View:
    world=repo.get_world(world_id); character=repo.get_character(character_id) if character_id else Character(world_id=world_id)
    if not world or (character_id and not character):raise ValueError("Character not found")
    is_new=character.id is None; state={"section":0}
    hub_managed=bool(getattr(character,"hub_id",None))
    name=th.UnderlinedField("Name",character.name);nick=th.UnderlinedField("Nicknames",character.nicknames)
    age=th.UnderlinedField("Age",character.age);role=th.UnderlinedField("Role",character.role)
    summary=th.UnderlinedField("Summary",character.summary,multiline=True,lines=2,max_lines=2)
    fields={key:th.UnderlinedField(label,getattr(character,key),multiline=True,lines=5,max_lines=5)
            for label,key in SECTIONS if key!="sprites"}
    if hub_managed:
        for control in (name,nick,age,role,summary,*fields.values()):
            control.read_only=True
    selected_host=ft.Container()

    def profile_values():return {key:fields[key].value.strip() for _,key in SECTIONS if key!="sprites"}
    def written(label,key):
        if key=="sprites":return bool(character.id and repo.list_character_sprites(character.id))
        return bool(fields[key].value.strip())
    def refresh_section():
        label,key=SECTIONS[state["section"]]
        selected_host.content=sprite_summary() if key=="sprites" else fields[key]
        if selected_host.page:selected_host.update()

    def path():
        items=[]
        for label,key in SECTIONS:
            yes=written(label,key);items.append((label,"written" if yes else "empty","written" if yes else "empty"))
        return th.dot_path(items,state["section"],select_section)
    path_host=ft.Container()
    def select_section(index):state["section"]=index;path_host.content=path();refresh_section();path_host.update()

    def save(e=None):
        if not name.value.strip():th.snack(page,"A character needs a name.",True);return
        character.name,character.nicknames,character.age,character.role=name.value.strip(),nick.value.strip(),age.value.strip(),role.value.strip()
        character.summary=summary.value.strip()
        for key,value in profile_values().items():setattr(character,key,value)
        cid=repo.save_character(character);character.id=cid
        th.snack(page,"Profile saved.")
        if is_new:page.go(f"/world/{world_id}/character/{cid}")
        else:path_host.content=path();path_host.update()

    def import_image(kind):
        def result(e):
            if not e.files:return
            if not character.id:save()
            src=e.files[0].path
            if kind=="portrait":
                character.portrait_path=import_portrait(src,world.name,character.name);repo.set_character_image(character.id,"neutral",character.portrait_path)
            else:
                character.tile_image_path=import_character_tile(src,world.name,character.name);repo.save_character(character)
            page.go(f"/world/{world_id}/character/{character.id}")
        picker=ft.FilePicker(on_result=result);page.overlay.append(picker);page.update();picker.pick_files(allowed_extensions=["png","jpg","jpeg","webp"])

    def sprite_summary():
        sprites=repo.list_character_sprites(character.id) if character.id else []
        return ft.Column([th.body(f"{len(sprites)} custom sprites. Call signs let replies choose another expression."),
            ft.Container(height=12),th.secondary_action("Open the sprite editor →",lambda e:sprite_editor())],spacing=0)

    def sprite_editor(sprite=None):
        item=sprite or CharacterSprite(character_id=character.id or 0)
        sname=th.UnderlinedField("Sprite name",item.name);call=th.UnderlinedField("Call sign",item.call_sign,hint="[sad]")
        image_path={"value":item.image_path}
        preview=ft.Container(content=th.masked_art(item.image_path,170,220,hatch_caption="no sprite"))
        def pick(e):
            def result(ev):
                if not ev.files:return
                image_path["value"]=import_portrait(ev.files[0].path,world.name,character.name);preview.content=th.masked_art(image_path["value"],170,220);preview.update()
            picker=ft.FilePicker(on_result=result);page.overlay.append(picker);page.update();picker.pick_files(allowed_extensions=["png","jpg","jpeg","webp"])
        def persist(e):
            value=call.value.strip()
            if not re.fullmatch(r"\[[a-z0-9][a-z0-9_-]*\]",value):th.snack(page,"Use a call sign such as [sad] or [sword-attack].",True);return
            if not image_path["value"]:th.snack(page,"Import sprite art first.",True);return
            item.character_id=character.id;item.name=sname.value.strip();item.call_sign=value;item.image_path=image_path["value"]
            repo.save_character_sprite(item)
            if page.overlay:page.overlay.pop()
            path_host.content=path();refresh_section();page.update()
        existing=repo.list_character_sprites(character.id) if character.id else []
        rows=[]
        for s in existing:rows.extend([ft.Row([th.masked_art(s.image_path,52,66),th.ui_text(f"{s.name}  {s.call_sign}",color=th.TEXT_1),ft.Container(expand=True),
            *([] if hub_managed else [th.secondary_action("Edit",lambda e,x=s:sprite_editor(x)),th.destructive_action("Delete",lambda e,x=s:(repo.delete_character_sprite(x.id,character.id),sprite_editor()))])]),th.rule(.62)])
        th.overlay(page,"Give the model another expression.",ft.Row([ft.Column([preview,th.secondary_action("Import sprite art",pick)],spacing=10),ft.Container(width=50),
            ft.Column([sname,call,ft.Container(height=8),*rows],expand=True,spacing=12)],vertical_alignment=ft.CrossAxisAlignment.START),
            [th.text_action("Save the sprite →",persist)],"Sprites")

    def remove(e):
        def yes(ev):repo.delete_character(character.id);page.go(f"/world/{world_id}/characters")
        th.overlay(page,f"Delete {character.name}?",th.body("Their profile, sprites and memories will be removed."),
            [th.destructive_action(f"Delete {character.name}",yes)],"Confirmation")

    path_host.content=path();refresh_section()
    missing=[label for label,key in SECTIONS if not written(label,key)]
    count=8-len(missing)
    sentence=(f"{count} of the eight profile sections are written — {missing[0]} is still empty, so the model must improvise it."
              if missing else "All eight profile sections are written. The model has a complete voice to follow.")
    art,_=th.portrait(character.portrait_path,th.character_color(character),500,730)
    # Keep the portrait tied to the viewport, independent of the editor's
    # scroll extent or the amount of text in a profile field.
    backdrop=ft.Container(left=-90,top=0,bottom=0,width=500,
        alignment=ft.alignment.bottom_left,content=art,clip_behavior=ft.ClipBehavior.HARD_EDGE)
    editor=ft.ListView([th.eyebrow("Character"),th.display(character.name or "Someone new",88,max_lines=1),
        th.body(sentence,max_lines=2),ft.Container(height=22),th.eyebrow("Basics"),ft.Container(height=10),
        ft.Row([ft.Container(name,expand=2),ft.Container(nick,expand=2),ft.Container(age,expand=1),ft.Container(role,expand=2)],spacing=24),
        ft.Container(height=14),summary,ft.Container(height=18),th.rule(.76),ft.Container(height=18),
        ft.Row([th.eyebrow("The profile"),th.caption(f"{count} written, {len(missing)} empty.")],spacing=14),
        ft.Container(height=15),path_host,ft.Container(height=16),selected_host,ft.Container(expand=True),
        (th.caption("This character comes from a World Hub publication and is read-only here. "
                    "Updates arrive through Settings → World Hub content.") if hub_managed else
         ft.Row([th.text_action("Save the profile →",save,size=30),th.secondary_action("Import a portrait",lambda e:import_image("portrait")),
            th.secondary_action("Import a shelf image",lambda e:import_image("tile")),ft.Container(expand=True),
            *([] if is_new else [th.destructive_action(f"Delete {character.name}",remove)])]))],expand=True,spacing=0,padding=0)
    body=(editor if th.compact(page) else ft.Row([ft.Container(width=350),editor],expand=True))
    return th.screen(page,f"/world/{world_id}/character/{character.id or 'new'}",body,
        back_route=f"/world/{world_id}/characters",back_label=world.name,
        right_actions=[] if is_new else [th.secondary_action("Memories →",lambda e:page.go(f"/world/{world_id}/character/{character.id}/memories"))],backdrop=backdrop)
