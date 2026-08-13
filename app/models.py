"""Dataclasses mirroring the database entities."""

from dataclasses import dataclass, field


@dataclass
class World:
    id: int | None = None
    name: str = ""
    genre: str = ""
    tone: str = ""
    summary: str = ""
    setting_description: str = ""
    style_guide: str = ""
    cover_image_path: str = ""
    session_background_path: str = ""
    created_at: str = ""


@dataclass
class Character:
    id: int | None = None
    world_id: int = 0
    name: str = ""
    nicknames: str = ""
    age: str = ""
    role: str = ""
    summary: str = ""
    appearance: str = ""
    personality: str = ""
    backstory: str = ""
    behavior_rules: str = ""
    voice_style: str = ""
    relationship_to_user: str = ""
    ai_instructions: str = ""
    created_at: str = ""
    portrait_path: str = ""  # joined from character_images (expression='neutral')
    tile_image_path: str = ""


@dataclass
class CharacterSprite:
    id: int | None = None
    character_id: int = 0
    name: str = ""
    call_sign: str = ""
    image_path: str = ""


@dataclass
class Scene:
    id: int | None = None
    world_id: int = 0
    location_id: int | None = None
    title: str = ""
    premise: str = ""
    tone: str = ""
    time_of_day: str = ""
    relationship_status: str = ""
    mode: str = "roleplay"  # roleplay | interview | author
    summary: str = ""
    narrator_enabled: bool = False
    persona_id: int | None = None
    created_at: str = ""
    updated_at: str = ""
    character_ids: list[int] = field(default_factory=list)


@dataclass
class Message:
    id: int | None = None
    scene_id: int = 0
    role: str = "user"  # user | character | narrator | system-note
    content: str = ""
    created_at: str = ""
    is_deleted: bool = False
    emotion: str = ""


@dataclass
class Memory:
    id: int | None = None
    character_id: int = 0
    type: str = "canon"  # canon | relationship | session
    content: str = ""
    source_scene_id: int | None = None
    status: str = "approved"
    created_at: str = ""


@dataclass
class LoreEntry:
    id: int | None = None
    world_id: int = 0
    title: str = ""
    content: str = ""
    keywords: str = ""  # comma-separated match terms
    always_include: bool = False


@dataclass
class WorldNote:
    """Private worldbuilding note. Never injected into scene prompts."""

    id: int | None = None
    world_id: int = 0
    title: str = ""
    content: str = ""
    category: str = "Unsorted"
    is_pinned: bool = False
    context_mode: str = "relevant"
    last_opened_at: str | None = None
    lifecycle_status: str = "canonical"
    workspace_session_id: int | None = None
    proposal_message_id: int | None = None
    created_at: str = ""
    updated_at: str = ""


@dataclass
class NoteChatMessage:
    """One turn of the notes-workspace assistant chat."""

    id: int | None = None
    world_id: int = 0
    role: str = "user"  # user | assistant
    content: str = ""
    created_at: str = ""


@dataclass
class Persona:
    id: int | None = None
    name: str = ""
    description: str = ""


@dataclass
class SceneTemplate:
    id: int | None = None
    world_id: int = 0
    name: str = ""
    premise: str = ""
    tone: str = ""
    time_of_day: str = ""
    relationship_status: str = ""
    mode: str = "roleplay"
    narrator_enabled: bool = False
    location_id: int | None = None
    persona_id: int | None = None
    character_ids: list[int] = field(default_factory=list)


SCENE_MODES = ("roleplay", "interview", "author")
MEMORY_TYPES = ("canon", "relationship", "session")
NOTE_CATEGORIES = (
    "Characters",
    "Setting",
    "Plot",
    "Unsorted",
)
NOTE_CONTEXT_MODES = ("always", "relevant", "excluded")
NOTE_LIFECYCLE_STATUSES = ("canonical", "proposed", "rejected", "superseded")
