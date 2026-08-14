"""Provider and reading settings, carried by state and typography."""

import time
import flet as ft
from .. import repository as repo
from ..providers.base import ProviderError
from ..providers.openai_compat import get_provider
from . import theme as th


def _worldhub_section(page: ft.Page, rerender) -> ft.Control:
    """World Hub content: install, link, preview, activate, roll back."""
    from app.worldhub import consumer_service as hub

    status = hub.status()
    if status["hub_mode"]:
        receipt = status["receipt"] or {}
        summary = (f"Hub mode — “{receipt.get('productionName','?')}” revision "
                   f"{receipt.get('productionRevision','?')}, publication "
                   f"{str(status['publication_id'])[:8]}…, imported "
                   f"{str(receipt.get('importedAt',''))[:10]}.")
    else:
        summary = ("Legacy mode — worlds and characters are authored in this app. "
                   "Install a World Hub publication to make the Hub the canon source.")
    linked = status["linked_folder"] or "No production folder linked."

    def show_preview(staged):
        preview = hub.preview(staged)
        lines = []
        if preview.already_active: lines.append("This publication is already active.")
        if preview.added_worlds: lines.append("Worlds added: " + ", ".join(preview.added_worlds))
        if preview.added_characters: lines.append("Characters added: " + ", ".join(preview.added_characters))
        if preview.updated_characters: lines.append("Characters updated: " + ", ".join(preview.updated_characters))
        if preview.retired_characters:
            lines.append("Characters retiring (old conversations keep them): " + ", ".join(preview.retired_characters))
        if preview.lore_documents: lines.append(f"{preview.lore_documents} lore document(s) included.")
        if preview.pinned_scenes:
            lines.append(f"{preview.pinned_scenes} existing conversation(s) stay pinned to the canon they began with.")
        if not lines: lines.append("No visible content changes.")

        def do_activate(e):
            try: hub.activate(staged)
            except Exception as error:
                th.snack(page, str(error), True); return
            if page.overlay: page.overlay.pop()
            th.snack(page, "The publication is now active. New conversations use it.")
            rerender(); page.update()

        def cancel(e):
            staged.cleanup()
            if page.overlay: page.overlay.pop()
            page.update()

        th.overlay(page, f"Activate “{preview.production_name}”?",
            ft.Column([th.body(line) for line in lines] +
                      [th.caption("Scenes, messages, memories, personas, and notes are never touched. "
                                  "A failed import changes nothing.")], spacing=10),
            [th.text_action("Activate →", do_activate), th.secondary_action("Cancel", cancel)],
            "World Hub")

    def install_zip(e):
        def result(ev):
            if not ev.files: return
            try: staged = hub.stage_zip(ev.files[0].path)
            except Exception as error:
                th.snack(page, str(error), True); return
            show_preview(staged)
        picker = ft.FilePicker(on_result=result); page.overlay.append(picker); page.update()
        picker.pick_files(allow_multiple=False, allowed_extensions=["zip"])

    def link_folder(e):
        def result(ev):
            if not ev.path: return
            try: hub.link_folder(ev.path)
            except Exception as error:
                th.snack(page, str(error), True); return
            th.snack(page, "Production folder linked."); rerender()
        picker = ft.FilePicker(on_result=result); page.overlay.append(picker); page.update()
        picker.get_directory_path()

    def check_update(e):
        try: staged = hub.stage_linked_folder()
        except Exception as error:
            th.snack(page, str(error), True); return
        show_preview(staged)

    def roll_back(e):
        try: hub.rollback()
        except Exception as error:
            th.snack(page, str(error), True); return
        th.snack(page, "Rolled back to the previous publication."); rerender()

    actions = [th.secondary_action("Install publication ZIP →", install_zip),
               th.secondary_action("Link production folder →", link_folder)]
    if status["linked_folder"]:
        actions.append(th.secondary_action("Check for update →", check_update))
    if status["previous_publication_id"]:
        actions.append(th.secondary_action("Roll back", roll_back))

    return ft.Column([th.eyebrow("World Hub content"), ft.Container(height=12),
        th.body(summary), ft.Container(height=6), th.caption(f"Linked folder: {linked}"),
        ft.Container(height=18), ft.Row(actions, spacing=22, wrap=True),
        ft.Container(height=12),
        th.caption("The publication is copied into this app's data, so everything keeps "
                   "working when the Hub library is unavailable.")], spacing=0)


def settings_view(page: ft.Page) -> ft.View:
    saved = repo.get_settings()
    state = {"section": "Endpoint", "latency": None, "models": [], "connected": False}
    headline = th.display("Nothing has answered yet.", 62, max_lines=2)
    subline = th.body("")
    section_host = ft.Container(expand=True)

    base_url = th.UnderlinedField("Base URL", saved.get("base_url", ""))
    api_key = th.UnderlinedField("API key", saved.get("api_key", ""), password=True,
                                 can_reveal_password=True)
    model = th.UnderlinedField("Model", saved.get("model", ""))
    system_prompt = th.UnderlinedField("System prompt", saved.get("system_prompt", ""),
                                       multiline=True, lines=5)
    temperature = th.UnderlinedField("Temperature", saved.get("temperature", ".8"))
    top_p = th.UnderlinedField("Top-p", saved.get("top_p", ".95"))
    max_tokens = th.UnderlinedField("Max tokens", saved.get("max_tokens", "1024"))
    history = th.UnderlinedField("History window", saved.get("history_limit", "30"))
    display_mode = saved.get("display_mode", "chat")
    reduce_motion = saved.get("reduce_motion", "0") == "1"
    text_scale = saved.get("text_scale", "1.0")
    streaming = saved.get("streaming", "1") == "1"

    def prose():
        model_name = model.value.strip() or "no model yet"
        mode = "streaming" if streaming else "waiting for complete replies"
        subline.value = f"You are talking to {model_name}, {mode}, at temperature {temperature.value or '0.8'}."
        if state["connected"]:
            headline.value = f"The endpoint answered in {state['latency']} ms."
        else:
            headline.value = f"Nothing is answering at {base_url.value or 'the endpoint'}."

    def save(show=True):
        for label, control in (("temperature", temperature), ("top-p", top_p),
            ("max tokens", max_tokens), ("history window", history)):
            try: float(control.value)
            except ValueError:
                th.snack(page, f"{label.title()} needs a number.", True); return False
        repo.save_settings({"base_url": base_url.value.strip(), "api_key": api_key.value.strip(),
            "model": model.value.strip(), "temperature": temperature.value.strip(),
            "top_p": top_p.value.strip(), "max_tokens": max_tokens.value.strip(),
            "history_limit": history.value.strip(), "streaming": "1" if streaming else "0",
            "system_prompt": system_prompt.value.strip(), "display_mode": display_mode,
            "reduce_motion": "1" if reduce_motion else "0", "text_scale": text_scale})
        prose()
        if headline.page: headline.update(); subline.update()
        if show: th.snack(page, "Settings saved.")
        return True

    async def test_connection(e):
        started = time.perf_counter()
        try:
            models = await get_provider().list_models({"base_url": base_url.value,
                                                        "api_key": api_key.value})
        except ProviderError as exc:
            state["connected"] = False; prose(); headline.update(); subline.update()
            th.snack(page, str(exc), True); return
        state.update(connected=True, latency=round((time.perf_counter()-started)*1000), models=models)
        if models and not model.value: model.value = models[0]
        save(False); render_section()

    def choose_model(value): model.value = value; save(False); render_section()
    def choose_mode(value):
        nonlocal display_mode
        display_mode = "chat" if value == "Rolling chat" else "vn"; save(False); render_section()
    def choose_stream(value):
        nonlocal streaming
        streaming = value == "Streaming"; save(False); render_section()
    def choose_motion(value):
        nonlocal reduce_motion
        reduce_motion = value == "Reduced"; th.configure_accessibility(reduce_motion, float(text_scale)); save(False); render_section()
    def choose_scale(value):
        nonlocal text_scale
        text_scale = {"Standard":"1.0", "Comfortable":"1.2", "Large":"1.4"}[value]
        th.configure_accessibility(reduce_motion, float(text_scale)); save(False); render_section()

    def numeric(control, fill, sentence):
        return ft.Column([ft.Row([th.numeral(control.value, 40), th.caption(sentence)], spacing=16),
                          th.fading_bar(fill, 420)], spacing=9)

    def render_section():
        if state["section"] == "Endpoint":
            model_ctl = th.select_row("Models found", model.value,
                [(m, m) for m in state["models"]], choose_model) if state["models"] else model
            content = ft.Row([ft.Column([th.eyebrow("The endpoint"), ft.Container(height=12),
                base_url, ft.Container(height=16), api_key, ft.Container(height=16), model_ctl,
                ft.Container(height=20), ft.Row([th.secondary_action("Test the connection →", test_connection),
                    th.pulse_dot(page, "live", th.GOOD) if state["connected"] else th.caption("not tested")], spacing=14)],
                width=520, spacing=0), ft.Container(width=80),
                ft.Column([th.eyebrow("The system prompt"), ft.Container(height=12), system_prompt,
                    ft.Container(height=9), th.caption("Sent before character, world, scene, lore and memory context.")],
                    expand=True, spacing=0)], vertical_alignment=ft.CrossAxisAlignment.START)
        elif state["section"] == "Generation":
            content = ft.Row([ft.Column([th.eyebrow("Sampling"), ft.Container(height=18),
                numeric(temperature, min(1,float(temperature.value or .8)/2), "temperature"), ft.Container(height=22),
                numeric(top_p, min(1,float(top_p.value or .95)), "top-p"), ft.Container(height=22),
                numeric(history, min(1,float(history.value or 30)/100), "messages of history sent per request")],
                width=520, spacing=0), ft.Container(width=80), ft.Column([
                    th.eyebrow("Limits and delivery"), ft.Container(height=18), max_tokens,
                    ft.Container(height=24), th.text_tabs(["Streaming", "Complete replies"],
                        "Streaming" if streaming else "Complete replies", choose_stream, neutral=True),
                    ft.Container(height=12), th.body("Replies appear as they arrive." if streaming else "Replies appear only when complete.")],
                    expand=True, spacing=0)])
        elif state["section"] == "World Hub":
            content = _worldhub_section(page, render_section)
        else:
            content = ft.Row([ft.Column([th.eyebrow("How scenes are shown"), ft.Container(height=16),
                th.text_tabs(["Rolling chat", "Visual novel"],
                    "Rolling chat" if display_mode == "chat" else "Visual novel", choose_mode),
                ft.Container(height=12), th.body("The whole exchange stays on the page." if display_mode == "chat" else "The latest exchange rests over the scene art.")], width=520, spacing=0),
                ft.Container(width=80), ft.Column([th.eyebrow("Reading"), ft.Container(height=16),
                th.text_tabs(["Full motion", "Reduced"], "Reduced" if reduce_motion else "Full motion", choose_motion, neutral=True),
                ft.Container(height=22), th.text_tabs(["Standard", "Comfortable", "Large"],
                    {"1.0":"Standard","1.2":"Comfortable","1.4":"Large"}.get(text_scale,"Standard"), choose_scale, neutral=True),
                ft.Container(height=12), th.caption("Headlines scale and wrap; interface text remains stable.")], expand=True, spacing=0)])
        section_host.content = content
        if section_host.page: section_host.update()

    def choose_section(value): state["section"] = value; render_section()
    prose(); render_section()
    body = ft.Column([th.eyebrow("Settings"), ft.Container(height=10), headline,
        ft.Container(height=10), subline, ft.Container(height=28),
        th.text_tabs(["Endpoint", "Generation", "Appearance", "World Hub"], state["section"], choose_section),
        ft.Container(height=28), section_host, th.rule(.76), ft.Container(height=14),
        ft.Row([th.secondary_action("Save settings", lambda e: save()),
                ft.Container(expand=True), th.caption("Nothing changes the model until the next request.")])],
        spacing=0, expand=True)
    return th.screen(page, "/settings", body, back_route="/", back_label="Worlds",
                     right_actions=[th.secondary_action("Personas", lambda e: page.go("/personas"))])
