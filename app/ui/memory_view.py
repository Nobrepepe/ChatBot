"""What a character carries into every scene."""

import flet as ft
from .. import repository as repo
from ..models import Memory
from . import theme as th


def memory_view(page: ft.Page, world_id: int, character_id: int) -> ft.View:
    world=repo.get_world(world_id);character=repo.get_character(character_id)
    if not world or not character:raise ValueError("Character not found")
    host=ft.Container(expand=True)

    def editor(memory=None,kind="canon"):
        item=memory or Memory(character_id=character_id,type=kind)
        content=th.UnderlinedField("Memory",item.content,multiline=True,lines=6)
        def save(e):
            if not content.value.strip():th.snack(page,"A memory needs something true to carry.",True);return
            item.content=content.value.strip();item.status="approved";repo.save_memory(item)
            if page.overlay:page.overlay.pop()
            render();page.update()
        th.overlay(page,"What should remain true?",ft.Column([content,
            th.caption("Canon and relationship memories are injected into every prompt for this character.")],spacing=14),
            [th.text_action("Keep this memory →",save)],f"{item.type} memory")

    def remove(item):repo.delete_memory(item.id);render()
    def approve(item):item.status="approved";repo.save_memory(item);render()
    def reject(item):repo.delete_memory(item.id);render()

    def memory_rows(items,review=False):
        rows=[]
        for i,item in enumerate(items):
            actions=([th.secondary_action("Approve",lambda e,x=item:approve(x)),
                      th.secondary_action("Edit",lambda e,x=item:editor(x)),
                      th.destructive_action("Reject",lambda e,x=item:reject(x))] if review else
                     [th.secondary_action("Edit",lambda e,x=item:editor(x)),
                      th.destructive_action("Delete",lambda e,x=item:remove(x))])
            rows.extend([ft.Container(ft.Row([th.body(item.content,14.5,th.TEXT_1,expand=True),*actions],spacing=20),
                padding=ft.padding.symmetric(vertical=9)),th.rule(.57+i%4*.07)])
        if not rows:rows.append(th.caption("Nothing here yet."))
        return rows

    def render():
        approved=repo.list_memories(character_id,status="approved")
        pending=repo.list_memories(character_id,status="pending")
        canon=[m for m in approved if m.type=="canon"]
        relationship=[m for m in approved if m.type=="relationship"]
        sessions=[m for m in approved if m.type=="session"]
        host.content=ft.ListView([ft.Row([th.eyebrow("Canon · permanently true"),ft.Container(expand=True),
            th.secondary_action("Add canon →",lambda e:editor(kind="canon"))]),*memory_rows(canon),ft.Container(height=18),
            ft.Row([th.eyebrow("Relationship · how they feel about you"),ft.Container(expand=True),
            th.secondary_action("Add relationship →",lambda e:editor(kind="relationship"))]),*memory_rows(relationship),ft.Container(height=18),
            ft.Row([th.eyebrow("Waiting for review"),ft.Container(expand=True),
                th.pulse_dot(page,"blocking review",th.BAD) if pending else th.caption("nothing waiting")]),*memory_rows(pending,True),
            ft.Container(height=20),th.disclosure("Session memories, never sent to the model",
                [(f"Scene memory {i+1}",m.content) for i,m in enumerate(sessions)])],spacing=0,padding=0)
        if host.page:host.update()
    render()
    approved=repo.list_memories(character_id,status="approved")
    injected=sum(1 for m in approved if m.type in ("canon","relationship"))
    art,_=th.portrait(character.portrait_path,th.character_color(character),460,680)
    backdrop=ft.Container(right=-80,bottom=-80,opacity=.6,content=art)
    body=ft.Column([th.eyebrow("Memory"),ft.Container(height=8),
        th.display(f"{character.name} carries {injected} into every scene.",56,max_lines=2),
        th.body("Canon and relationship memories are always included. Session memories remain here for review, but never enter a prompt."),
        ft.Container(height=30),host],spacing=0,expand=True)
    return th.screen(page,f"/world/{world_id}/character/{character_id}/memories",body,
        back_route=f"/world/{world_id}/character/{character_id}",back_label=character.name,backdrop=backdrop)
