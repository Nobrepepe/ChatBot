"""Chat orchestration: builds prompts, streams replies, persists messages."""

import re
from collections.abc import AsyncIterator
from dataclasses import dataclass

from .. import repository as repo
from ..models import Character, Memory, Persona, Scene, World
from ..prompt_builder import (
    BuiltPrompt,
    build_continuation_prompt,
    build_impersonation_prompt,
    build_memory_suggestion_prompt,
    build_prompt,
    build_summary_prompt,
    match_lore,
)
from ..providers.openai_compat import get_provider

_SUGGESTION_LINE_RE = re.compile(r"^\s*(?:[-*\u2022]|\d+[.)])\s+(.*\S)\s*$")


@dataclass
class ChatContext:
    world: World
    characters: list[Character]
    scene: Scene
    persona: Persona | None

    @property
    def character(self) -> Character:
        """Primary character (single-character scenes)."""
        return self.characters[0]

    @classmethod
    def load(cls, scene_id: int) -> "ChatContext":
        scene = repo.get_scene(scene_id)
        if scene is None:
            raise ValueError(f"Scene {scene_id} not found")
        world = repo.get_world(scene.world_id)
        characters = [
            c for cid in scene.character_ids
            if (c := repo.get_character(cid)) is not None
        ]
        if world is None or not characters:
            raise ValueError("Scene is missing its world or characters")
        persona = repo.get_persona(scene.persona_id) if scene.persona_id else None
        return cls(world=world, characters=characters, scene=scene, persona=persona)


class ChatService:
    """One instance per open chat screen."""

    def __init__(self, scene_id: int):
        self.scene_id = scene_id
        self.ctx = ChatContext.load(scene_id)
        self.provider = get_provider()
        self.last_prompt: BuiltPrompt | None = None
        self.last_lore_matches: list = []

    # ------------------------------------------------------------ prompts

    @property
    def emotion_tags_enabled(self) -> bool:
        """Emotion tags are useful whenever a roleplay character has images."""
        if self.ctx.scene.mode == "author":
            return False
        return any(repo.list_character_images(c.id) for c in self.ctx.characters)

    def build(
        self, before_message_id: int | None = None, responder_id: int | None = None,
        respond_to_latest: bool = False,
    ) -> BuiltPrompt:
        settings = repo.get_settings()
        try:
            history_limit = max(1, int(settings.get("history_limit", "30")))
        except ValueError:
            history_limit = 30
        # Reload so scene/summary/mode edits are always reflected.
        self.ctx = ChatContext.load(self.scene_id)
        history = repo.list_messages(self.scene_id)
        if before_message_id is not None:
            idx = next(
                (i for i, m in enumerate(history) if m.id == before_message_id), None
            )
            if idx is not None:
                history = history[:idx]
        memories_by_char = {
            c.id: repo.list_memories(c.id, types=("canon", "relationship"))
            for c in self.ctx.characters
        }
        lore_entries = repo.list_lore_entries(self.ctx.world.id)
        lore_matches = match_lore(lore_entries, self.ctx.scene, history)
        self.last_lore_matches = lore_matches
        responder = next(
            (c for c in self.ctx.characters if c.id == responder_id), None
        )
        sprite_character = responder or self.ctx.character
        sprite_rows = repo.list_character_sprites(sprite_character.id)
        sprite_names = {s.call_sign: s.name for s in sprite_rows}
        if repo.list_character_images(sprite_character.id).get("neutral"):
            sprite_names = {"neutral": "Main portrait", **sprite_names}
        built = build_prompt(
            world=self.ctx.world,
            characters=self.ctx.characters,
            scene=self.ctx.scene,
            memories_by_char=memories_by_char,
            lore_matches=lore_matches,
            persona=self.ctx.persona,
            history=history,
            history_limit=history_limit,
            emotion_tags=self.emotion_tags_enabled,
            sprites=sprite_names,
            responder=responder,
            respond_to_latest=respond_to_latest,
            system_prompt=settings.get("system_prompt", ""),
        )
        # Some OpenAI-compatible thinking models interpret a trailing assistant
        # history item as an unsupported response prefill. A transient user-side
        # control turn keeps the request protocol-valid without adding a visible
        # or persisted user message to the scene.
        if respond_to_latest and responder is not None:
            built.messages.append({
                "role": "user",
                "content": (
                    f"[Turn control: Have {responder.name} respond directly to the "
                    "latest character reply. Do not treat this control instruction "
                    "as dialogue from the user and do not mention it.]"
                ),
            })
        self.last_prompt = built
        return built

    # ------------------------------------------------------------ actions

    def add_user_message(self, content: str) -> int:
        return repo.add_message(self.scene_id, "user", content)

    async def stream_reply(
        self, responder_id: int | None = None, respond_to_latest: bool = False
    ) -> AsyncIterator[str]:
        """Stream the character's reply. Caller persists the result."""
        built = self.build(
            responder_id=responder_id, respond_to_latest=respond_to_latest
        )
        settings = repo.get_settings()
        async for chunk in self.provider.stream_chat(built.messages, settings):
            yield chunk

    async def stream_continuation(
        self, message_id: int, partial: str
    ) -> AsyncIterator[str]:
        """Stream a continuation of a trimmed character reply.

        The prompt contains the history up to (excluding) the message and the
        partial text as the last assistant turn. Caller persists the result.
        """
        built = self.build(before_message_id=message_id)
        messages = build_continuation_prompt(built, partial)
        settings = repo.get_settings()
        async for chunk in self.provider.stream_chat(messages, settings):
            yield chunk

    def save_reply(self, content: str, emotion: str = "") -> int:
        return repo.add_message(self.scene_id, "character", content, emotion=emotion)

    async def _run_once(self, messages: list[dict]) -> str:
        settings = repo.get_settings()
        parts: list[str] = []
        async for chunk in self.provider.stream_chat(messages, settings):
            parts.append(chunk)
        return "".join(parts).strip()

    async def summarize(self) -> str:
        """Ask the model for a scene summary and store it on the scene."""
        history = repo.list_messages(self.scene_id)
        messages = build_summary_prompt(self.ctx.characters, self.ctx.scene, history)
        summary = await self._run_once(messages)
        if summary:
            repo.set_scene_summary(self.scene_id, summary)
        return summary

    async def impersonate(self, draft: str = "") -> str:
        """Generate, but do not persist, a suggested turn for the user persona."""
        built = self.build()
        persona = self.ctx.persona
        if persona is None:
            raise ValueError("This scene does not have a user persona")
        return await self._run_once(build_impersonation_prompt(built, persona, draft))

    async def suggest_memories(self) -> list[Memory]:
        """Ask the model for candidate memories; store them as 'suggested'."""
        history = repo.list_messages(self.scene_id)
        messages = build_memory_suggestion_prompt(
            self.ctx.characters, self.ctx.scene, history
        )
        raw = await self._run_once(messages)
        suggestions: list[Memory] = []
        for line in raw.splitlines():
            m = _SUGGESTION_LINE_RE.match(line)
            if not m:
                continue
            content = m.group(1).strip()
            if not content:
                continue
            character = self._guess_character(content)
            memory = Memory(
                character_id=character.id,
                type="canon",
                content=content,
                source_scene_id=self.scene_id,
                status="pending",
            )
            memory.id = repo.save_memory(memory)
            suggestions.append(memory)
        return suggestions

    def _guess_character(self, text: str) -> Character:
        """Attribute a suggested memory to the character named in it."""
        lowered = text.lower()
        for c in self.ctx.characters:
            if c.name and c.name.lower() in lowered:
                return c
        return self.ctx.character
