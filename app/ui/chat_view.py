"""Rolling and visual-novel conversation views without bubbles."""

import datetime
import re
import flet as ft
from .. import repository as repo
from ..database import DATA_DIR
from ..models import Message
from ..prompt_builder import parse_emotion
from ..providers.base import ProviderError
from ..services.chat_service import ChatService
from . import theme as th
from .prompt_debug import open_prompt_debug

CURSOR=" ▌"


def chat_view(page: ft.Page, scene_id: int) -> ft.View:
    service=ChatService(scene_id);ctx=service.ctx;settings=repo.get_settings();multi=len(ctx.characters)>1
    state={"busy":False,"display":settings.get("display_mode","chat"),"speaker":ctx.character,
           "responder":ctx.character.id,"stream":""}
    transcript=ft.ListView(expand=True,spacing=24,
        padding=ft.padding.only(top=14,right=10,bottom=18),auto_scroll=True,
        build_controls_on_demand=True)
    vn_host=ft.Container(expand=True)
    mode_host=ft.Container(expand=True,clip_behavior=ft.ClipBehavior.HARD_EDGE)
    context_host=ft.Container()
    portrait_host=ft.Container()
    input_field=th.UnderlinedField("Say something", "", multiline=True, lines=1)
    input_field.text_field.max_lines=4
    # In a multiline Flet field this makes plain Enter submit and reserves a
    # newline for Shift+Enter.
    input_field.text_field.shift_enter=True

    def speaker_for(msg):
        if msg.role=="user":return ctx.persona.name if ctx.persona else "You"
        if msg.role=="narrator":return "Narrator"
        tagged=re.match(r"^\s*\{([^{}\n]+)\}\s*",msg.content)
        if tagged:
            char=next((c for c in ctx.characters if c.name.casefold()==tagged.group(1).strip().casefold()),None)
            if char:return char.name
        return state["speaker"].name

    def character_for(msg):
        name=speaker_for(msg)
        return next((c for c in ctx.characters if c.name==name),state["speaker"])

    def portrait_for(msg=None,streaming=False):
        character=state["speaker"] if msg is None else character_for(msg)
        emotion=""
        if msg is not None:
            emotion=msg.emotion or parse_emotion(msg.content)[0]
        images=repo.list_character_images(character.id)
        sprites={s.call_sign.strip("[]"):s.image_path for s in repo.list_character_sprites(character.id)}
        src=sprites.get(emotion) or images.get(emotion) or character.portrait_path
        art,_=th.portrait(src,th.character_color(character),290,390,floor_fade=False)
        portrait_host.content=art
        if portrait_host.page:portrait_host.update()

    def clean(msg):
        text=re.sub(r"^\s*\{[^{}\n]+\}\s*","",msg.content)
        _,text=parse_emotion(text);return text

    def edit_message(msg):
        field=th.UnderlinedField("Message",msg.content,multiline=True,lines=8)
        def save(e):repo.update_message(msg.id,field.value.strip());close();refresh()
        async def save_continue(e):
            partial=field.value.strip()
            if not partial:return
            close();state["busy"]=True;state["stream"]=partial
            try:
                async for chunk in service.stream_continuation(msg.id,partial):
                    state["stream"]+=chunk;render_mode()
                repo.update_message(msg.id,state["stream"])
            except ProviderError as exc:th.snack(page,str(exc),True)
            finally:state["busy"]=False;state["stream"]="";refresh()
        def close():
            if page.overlay:page.overlay.pop()
            page.update()
        actions=[th.text_action("Save the message →",save)]
        if msg.role in ("character","narrator"):
            actions.append(th.secondary_action("Save & continue →",save_continue))
        th.overlay(page,"Change what remains in the transcript.",field,actions,"Message editor")

    def delete_message(msg):
        def yes(e):repo.delete_message(msg.id);page.overlay.pop();refresh();page.update()
        th.overlay(page,"Remove this turn?",th.body("It will no longer be sent to the model."),
            [th.destructive_action("Delete the message",yes)],"Confirmation")

    def save_memory(msg):
        character=character_for(msg)
        from ..models import Memory
        field=th.UnderlinedField("Memory",clean(msg),multiline=True,lines=6)
        def save(e):
            repo.save_memory(Memory(character_id=character.id,type="canon",content=field.value.strip(),source_scene_id=scene_id))
            page.overlay.pop();page.update();th.snack(page,"Memory saved.")
        th.overlay(page,f"What should {character.name} carry forward?",field,[th.text_action("Keep this memory →",save)],"Memory")

    def turn(msg,streaming=False):
        user=msg.role=="user";name=speaker_for(msg)
        actions=ft.Row([th.secondary_action("Edit",lambda e:edit_message(msg)),
            *([] if user else [th.secondary_action("Remember",lambda e:save_memory(msg))]),
            th.destructive_action("Delete",lambda e:delete_message(msg))],spacing=18,opacity=0)
        def hover(e):actions.opacity=1 if e.data=="true" else 0;actions.update()
        text=(state["stream"]+CURSOR) if streaming else clean(msg)
        heading=ft.Row([th.display(name,19,th.MUTED_2 if user else th.TEXT_1),
            *( [th.pulse_dot(page,"answering")] if streaming else []),ft.Container(expand=True),actions],spacing=10)
        content=ft.Column([heading,th.md(text,th.MUTED if user else th.TEXT_DIM,15.5)],spacing=6)
        if user:content=ft.Row([th.vrule(58),ft.Container(content,expand=True)],spacing=14)
        return ft.Container(content,margin=ft.margin.only(left=36 if user else 0),on_hover=hover,data=msg)

    def refresh_context():
        total=repo.count_messages(scene_id)
        try:limit=max(1,int(repo.get_settings().get("history_limit","30")))
        except ValueError:limit=30
        sent=min(total,limit)
        context_host.content=ft.Column([th.eyebrow("Context"),ft.Row([th.numeral(sent,34),
            th.caption(f"of {total} messages are being sent")],spacing=12,
            vertical_alignment=ft.CrossAxisAlignment.END),th.fading_bar(sent/max(total,1),330)],spacing=8)
        if context_host.page:context_host.update()

    def refresh():
        messages=repo.list_messages(scene_id)
        transcript.controls=[turn(m) for m in messages]
        if messages:
            latest_character=next((m for m in reversed(messages) if m.role!="user"),None)
            if latest_character:
                state["speaker"]=character_for(latest_character);portrait_for(latest_character)
        else:portrait_for()
        refresh_context();render_mode(messages)
        if transcript.page:transcript.update()

    def render_mode(messages=None):
        messages=messages if messages is not None else repo.list_messages(scene_id)
        if state["display"]=="chat":mode_host.content=transcript
        else:
            latest=messages[-1] if messages else None
            previous_user=next((m for m in reversed(messages[:-1] if latest else messages) if m.role=="user"),None)
            name=speaker_for(latest) if latest else state["speaker"].name
            reply=clean(latest) if latest else "The scene is waiting for the first line."
            vn_host.content=ft.ListView([
                th.caption(f"You: {clean(previous_user)}",th.MUTED_2) if previous_user else ft.Container(),
                ft.Container(height=12),th.rule(.66),ft.Container(height=14),
                ft.Row([th.display(name,38),*( [th.pulse_dot(page,"answering")] if state["busy"] else [])],spacing=12),
                ft.Container(height=8),th.md((state["stream"]+CURSOR) if state["busy"] else reply,th.TEXT_1,21)],
                spacing=0,auto_scroll=True,padding=0)
            mode_host.content=vn_host
        if mode_host.page:mode_host.update()

    def set_speaker_from(text):
        match=re.match(r"^\s*\{([^{}\n]+)\}",text)
        if match:
            found=next((c for c in ctx.characters if c.name.casefold()==match.group(1).strip().casefold()),None)
            if found:state["speaker"]=found

    async def stream_reply(respond_to_latest=False):
        if state["busy"]:return
        state["busy"]=True;state["stream"]="";placeholder=Message(scene_id=scene_id,role="character",content="")
        if state["display"]=="chat":transcript.controls.append(turn(placeholder,True));transcript.update()
        else:render_mode()
        try:
            async for chunk in service.stream_reply(state["responder"],respond_to_latest):
                state["stream"]+=chunk;set_speaker_from(state["stream"])
                if state["display"]=="chat":transcript.controls[-1]=turn(placeholder,True);transcript.update()
                else:render_mode()
            emotion,final=parse_emotion(re.sub(r"^\s*\{[^{}\n]+\}\s*","",state["stream"]))
            saved=final or state["stream"]
            if multi:saved=f"{{{state['speaker'].name}}} {saved}"
            service.save_reply(saved,emotion)
        except ProviderError as exc:th.snack(page,str(exc),True)
        finally:state["busy"]=False;state["stream"]="";refresh()

    async def send(e=None):
        text=input_field.value.strip()
        if state["busy"] or not text:return
        service.add_user_message(text);input_field.value="";input_field.text_field.update();refresh();await stream_reply()

    input_field.text_field.on_submit=send
    async def regenerate(e=None):
        messages=repo.list_messages(scene_id)
        if not messages:th.snack(page,"Send a message before regenerating.");return
        if messages[-1].role!="user":repo.delete_message(messages[-1].id)
        refresh();await stream_reply()
    async def impersonate(e=None):
        if not ctx.persona:th.snack(page,"Choose a persona in scene setup first.",True);return
        if state["busy"]:return
        state["busy"]=True
        try:input_field.value=await service.impersonate(input_field.value);input_field.text_field.update();input_field.focus()
        except (ProviderError,ValueError) as exc:th.snack(page,str(exc),True)
        finally:state["busy"]=False
    async def summarize(e=None):
        if not repo.list_messages(scene_id):th.snack(page,"Nothing to summarize yet.");return
        try:result=await service.summarize()
        except ProviderError as exc:th.snack(page,str(exc),True);return
        th.overlay(page,"What this scene now remembers.",th.md(result or "Nothing was returned.",th.TEXT_1),[],"Scene summary")
    async def suggest(e=None):
        try:items=await service.suggest_memories()
        except ProviderError as exc:th.snack(page,str(exc),True);return
        if not items:th.snack(page,"No memory suggestions were returned.");return
        rows=[]
        for item in items:
            field=th.UnderlinedField("Proposed memory",item.content,multiline=True,lines=3)
            def approve(ev,m=item,f=field):
                m.content=f.value.strip();m.status="approved";repo.save_memory(m)
                ev.control.disabled=True;ev.control.update();th.snack(page,"Memory approved.")
            def reject(ev,m=item):
                repo.delete_memory(m.id);ev.control.disabled=True;ev.control.update()
            rows.extend([field,ft.Row([th.secondary_action("Approve",approve),
                th.destructive_action("Reject",reject)],spacing=20),th.rule(.62)])
        th.overlay(page,"Review what may become canon.",ft.Column(rows,spacing=12),[],"Memory suggestions")
    def export(e=None):
        msgs=repo.list_messages(scene_id)
        if not msgs:th.snack(page,"Nothing to export yet.");return
        folder=DATA_DIR/"exports";folder.mkdir(parents=True,exist_ok=True)
        path=folder/f"scene_{scene_id}_{datetime.datetime.now():%Y%m%d_%H%M%S}.md"
        lines=[f"# {ctx.scene.title or 'Scene'}",""]
        for msg in msgs:lines.extend([f"**{speaker_for(msg)}:** {clean(msg)}",""])
        path.write_text("\n".join(lines),encoding="utf-8");th.snack(page,f"Exported to {path}")
    def backlog(e=None):
        rows=[]
        for msg in repo.list_messages(scene_id):rows.extend([th.display(speaker_for(msg),19),th.md(clean(msg)),th.rule(.62)])
        th.overlay(page,"Everything said in this scene.",ft.ListView(rows,spacing=10),[],"Backlog")
    def switch_mode(e=None):
        state["display"]="vn" if state["display"]=="chat" else "chat";repo.save_setting("display_mode",state["display"]);render_mode()
    def responder_overlay(e=None):
        tiles=[]
        for char in ctx.characters:
            chosen=char.id==state["responder"]
            if char.tile_image_path:
                tile=th.masked_art(char.tile_image_path,220,124);tile.opacity=1 if chosen else .42
            else:
                tile,_=th.portrait(char.portrait_path,th.character_color(char),140,170,ghost=not chosen)
            tiles.append(ft.Container(ft.Column([tile,th.display(char.name,20),th.caption("responds next" if chosen else "waiting")],spacing=3),
                on_click=lambda ev,c=char:(state.__setitem__("responder",c.id),state.__setitem__("speaker",c),page.overlay.pop(),page.update())))
        th.overlay(page,"Who answers next?",ft.Row(tiles,spacing=24),[th.text_action(f"Respond as {state['speaker'].name} →",lambda ev:page.run_task(stream_reply,True))],"Cast")

    refresh()
    background_src=""
    background_src=ctx.world.session_background_path or ctx.world.cover_image_path
    backdrop=ft.Stack([
        ft.Image(src=background_src,fit=ft.ImageFit.COVER,
                 opacity=.20 if state["display"]=="chat" else .28,expand=True,
                 filter_quality=ft.FilterQuality.HIGH)
                 if background_src else ft.Container(),
        ft.Container(expand=True,gradient=ft.LinearGradient(
            begin=ft.alignment.top_center,end=ft.alignment.bottom_center,
            colors=[ft.Colors.with_opacity(.72,th.BG),ft.Colors.with_opacity(.52,th.BG),
                    ft.Colors.with_opacity(.94,th.BG)],stops=[0,.42,1]))],expand=True)
    composer=ft.Column([
        ft.Row([th.secondary_action("Regenerate",regenerate),th.secondary_action("Impersonate",impersonate),
            th.caption("Enter sends · Shift+Enter makes a new line")],spacing=22),
        ft.Row([ft.Container(input_field,expand=True),th.text_action("Send →",send,size=24)],spacing=24)],
        spacing=8)
    tools=ft.Row([
        th.secondary_action("Rolling chat" if state["display"]=="vn" else "Visual novel",switch_mode),
        *([th.secondary_action("Backlog",backlog)] if state["display"]=="vn" else []),
        th.secondary_action("Summarize",summarize),th.secondary_action("Suggest memories",suggest),
        th.secondary_action("Export",export),th.secondary_action("Prompt debug",lambda e:open_prompt_debug(page,service))],
        spacing=20,wrap=True)
    art_panel=ft.Column([ft.Container(portrait_host,expand=True,
        alignment=ft.alignment.bottom_center),context_host],width=310,spacing=10)
    # Give this column a finite viewport height. mode_host then takes whatever
    # remains, so a composer growing to four lines takes space from the
    # transcript instead of extending the page downward.
    conversation_height=max(300, float(getattr(page,"height",820) or 820) -
                            (285 if th.compact(page) else 330))
    conversation=ft.Column([mode_host,th.rule(.72),
        ft.Container(height=10),composer],height=conversation_height,
        # In the desktop Row this supplies the conversation's horizontal
        # extent; height still provides the separate vertical constraint.
        expand=True,spacing=0)
    main_row=(conversation if th.compact(page) else ft.Row([art_panel,conversation],expand=True,spacing=34,
               vertical_alignment=ft.CrossAxisAlignment.END))
    def _pinned_notice():
        from app import repository as _repo
        active = _repo.active_publication_id()
        pinned = getattr(ctx.scene, "publication_id", None)
        if not active or not pinned or pinned == active:
            return ft.Container(height=0)
        def migrate(e):
            from app.worldhub import consumer_service as hub_service
            try: hub_service.migrate_scene(ctx.scene.id)
            except Exception as error:
                th.snack(page, str(error), True); return
            th.snack(page, "The conversation now uses the current canon.")
            page.go(f"/chat/{ctx.scene.id}")
        return ft.Row([th.caption("This conversation is pinned to the canon it began with."),
            th.secondary_action("Move it to the current canon →", migrate)], spacing=18)

    body=ft.Column([
        th.eyebrow(f"{ctx.world.name} · {ctx.scene.mode} · {', '.join(c.name for c in ctx.characters)}"),
        _pinned_notice(),
        ft.Container(height=4),th.display(ctx.scene.title or ctx.scene.premise or "Untitled scene",36),
        ft.Container(height=10),tools,ft.Container(height=10),th.rule(.84),
        main_row,
        ],spacing=0,expand=True)
    return th.screen(page,f"/chat/{scene_id}",body,back_route=f"/world/{ctx.world.id}/sessions",back_label=ctx.world.name,
        right_actions=[th.secondary_action("Choose responder",responder_overlay)] if multi else [],backdrop=backdrop)
