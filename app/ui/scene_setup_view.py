"""Scene setup: make the go/no-go comparison visible."""

import flet as ft
from .. import repository as repo
from ..models import Scene, SceneTemplate
from . import theme as th


def scene_setup_view(page: ft.Page, world_id: int, template_id: int | None = None) -> ft.View:
    world=repo.get_world(world_id)
    if not world:raise ValueError("World not found")
    characters=repo.list_characters(world_id);personas=repo.list_personas()
    templates=repo.list_scene_templates(world_id)
    state={"characters":set(),"mode":"Roleplay","persona":None,"narrator":False}
    premise=th.UnderlinedField("Premise","",multiline=True,lines=3)
    time=th.UnderlinedField("Time of day","");tone=th.UnderlinedField("Tone",world.tone)
    relationship=th.UnderlinedField("Relationship status","")
    cast_host=ft.Container();form_host=ft.Container();verdict_host=ft.Container()

    def choose_cast(cid):
        state["characters"].symmetric_difference_update({cid});render_cast();render_verdict()
    def render_cast():
        tiles=[]
        for char in characters:
            chosen=char.id in state["characters"]
            if char.tile_image_path:
                tile=th.character_tile(char.tile_image_path,220,124,not chosen)
            else:
                tile,_=th.portrait(char.portrait_path,th.character_color(char),220,124,ghost=not chosen)
            tiles.append(ft.Container(ft.Column([tile,th.display(char.name,20),
                th.caption("in this scene" if chosen else "not in this scene",
                           th.ACCENT if chosen else th.MUTED_2)],spacing=3),
                width=220,
                on_click=lambda e,cid=char.id:choose_cast(cid)))
        cast_host.content=th.responsive_grid(tiles,236,166,20)
        if cast_host.page:cast_host.update()

    def choose_persona(value):state["persona"]=int(value) if value else None;render_form()
    def choose_narrator(value):state["narrator"]=value=="On";render_form()
    def choose_mode(value):state["mode"]=value;render_form()
    def render_form():
        persona=th.select_row("You are",str(state["persona"] or ""),[("","Plain ‘you’")]+[(str(x.id),x.name) for x in personas],choose_persona)
        narrator=th.select_row("Narrator","On" if state["narrator"] else "Off",[("Off","Off"),("On","On")],choose_narrator)
        opening=ft.Column([time,ft.Container(height=12),premise,ft.Container(height=12),relationship],
                          expand=True,spacing=0)
        mode_column=ft.Column([th.eyebrow("Mode"),ft.Container(height=12),
            th.text_tabs(["Roleplay","Interview","Author assistant"],state["mode"],choose_mode),ft.Container(height=8),
            ft.Container(height=12),ft.Row([ft.Container(persona,expand=True),ft.Container(narrator,expand=True)],spacing=30),ft.Container(height=12),tone],expand=True,spacing=0)
        form_host.content=(ft.Column([opening,ft.Container(height=24),mode_column],spacing=0)
            if th.compact(page) else ft.Row([opening,ft.Container(width=70),mode_column],
                vertical_alignment=ft.CrossAxisAlignment.START))
        if form_host.page:form_host.update()

    def ready():return bool(state["characters"])
    def render_verdict(e=None):
        n=len(state["characters"]);missing=[]
        if not n:missing.append("a character")
        verdict_host.content=ft.Row([
            th.text_action("Begin the scene →",begin,size=34,enabled=not missing),
            th.pulse_dot(page,"ready") if not missing else th.caption("not ready"),
            ft.Container(expand=True),th.secondary_action("Save setup as template",save_template)],spacing=28)
        if verdict_host.page:verdict_host.update()

    premise.text_field.on_change=render_verdict
    def scene_value():
        mode={"Roleplay":"roleplay","Interview":"interview","Author assistant":"author"}[state["mode"]]
        title=next((line.strip() for line in premise.value.splitlines() if line.strip()),"New scene")
        return Scene(world_id=world_id,location_id=None,title=title[:80],premise=premise.value.strip(),
            tone=tone.value.strip(),time_of_day=time.value.strip(),relationship_status=relationship.value.strip(),
            mode=mode,narrator_enabled=state["narrator"],persona_id=state["persona"],character_ids=list(state["characters"]))
    def begin(e):
        if not ready():render_verdict();return
        sid=repo.save_scene(scene_value());page.go(f"/chat/{sid}")
    def save_template(e):
        if not state["characters"]:th.snack(page,"Choose at least one character before saving a template.",True);return
        title=th.UnderlinedField("Template name","")
        def persist(ev):
            scene=scene_value();repo.save_scene_template(SceneTemplate(world_id=world_id,name=title.value.strip() or "Untitled setup",
                premise=scene.premise,tone=scene.tone,time_of_day=scene.time_of_day,relationship_status=scene.relationship_status,
                mode=scene.mode,narrator_enabled=scene.narrator_enabled,
                location_id=scene.location_id,persona_id=scene.persona_id,character_ids=scene.character_ids))
            if page.overlay:page.overlay.pop()
            page.update();th.snack(page,"Scene template saved.")
        th.overlay(page,"Name this way back in.",title,[th.text_action("Save the template →",persist)],"Scene template")

    def load_template(value):
        template=next((x for x in templates if str(x.id)==value),None)
        if not template:return
        state["characters"]={cid for cid in template.character_ids if any(c.id==cid for c in characters)}
        state["mode"]={"roleplay":"Roleplay","interview":"Interview","author":"Author assistant"}.get(template.mode,"Roleplay")
        state["persona"]=template.persona_id;state["narrator"]=template.narrator_enabled
        premise.value=template.premise;time.value=template.time_of_day;tone.value=template.tone
        relationship.value=template.relationship_status
        render_cast();render_form();render_verdict()
        for field in (premise,time,tone,relationship):
            if field.text_field.page:field.text_field.update()

    template_row=(th.select_row("Saved setup","",[(str(x.id),x.name) for x in templates],load_template)
                  if templates else th.caption("No saved setups yet."))
    render_cast();render_form();render_verdict()
    if template_id:load_template(str(template_id))
    backdrop=None
    if world.cover_image_path:backdrop=ft.Stack([ft.Container(right=-180,top=-180,content=th.masked_art(world.cover_image_path,1000,562)),
        ft.Container(expand=True,gradient=th.scrim_top()),ft.Container(expand=True,gradient=th.scrim_side())],expand=True)
    scroll_content=ft.Column([ft.Row([th.display("New scene",36),ft.Container(expand=True),template_row]),
        ft.Container(height=12),th.eyebrow("Cast"),ft.Container(height=8),
        ft.Container(cast_host,height=170 if th.compact(page) else 190),ft.Container(height=12),th.rule(.66),
        ft.Container(height=12),form_host,ft.Container(height=12)],spacing=0)
    body=ft.Column([ft.ListView([scroll_content],expand=True,padding=0),th.rule(.78),
        ft.Container(height=12),verdict_host],spacing=0,expand=True)
    return th.screen(page,f"/world/{world_id}/scene/new",body,back_route=f"/world/{world_id}/sessions",back_label=world.name,backdrop=backdrop)
