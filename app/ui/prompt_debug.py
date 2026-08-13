"""Full-frame prompt inspection."""
import json
import flet as ft
from . import theme as th


def open_prompt_debug(page: ft.Page, service) -> None:
    built=service.build();rows=[]
    for index,section in enumerate(built.sections):
        rows.extend([th.eyebrow(section.label),th.caption(f"{len(section.content)} characters"),
            ft.Text(section.content or "(empty)",selectable=True,font_family="monospace",size=11,color=th.TEXT_DIM),th.rule(.57+index%4*.07)])
    payload=json.dumps(built.messages,indent=2,ensure_ascii=False)
    rows.extend([th.eyebrow("Final payload messages"),th.caption(f"{len(built.messages)} messages"),
        ft.Text(payload,selectable=True,font_family="monospace",size=10.5,color=th.TEXT_DIM)])
    th.overlay(page,"What the model is actually sent.",ft.ListView(rows,spacing=10),[],"Prompt debug")
