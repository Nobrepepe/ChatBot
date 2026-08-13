"""Builds the final prompt from world, characters, memories, scene, and history.

Every section is kept separately so the prompt debug panel can show exactly
what the model received.
"""

import re
from dataclasses import dataclass, field

from .models import (
    Character, LoreEntry, Memory, Message, NoteChatMessage,
    Persona, Scene, World, WorldNote,
)

MODE_INSTRUCTIONS = {
    "roleplay": (
        "This is an in-world roleplay. Respond as the character, in character at "
        "all times. Write dialogue in quotes and brief third-person narration for "
        "the character's actions when it helps the scene. Never speak or act for "
        "the user. Do not reveal the character's secrets too easily. Ask "
        "questions when natural. Keep replies to a few paragraphs at most."
    ),
    "interview": (
        "This is an interview between the writer (the user) and the character. "
        "The character answers questions honestly from their own point of view, "
        "in their own voice, as if reflecting on themselves. Stay in character, "
        "but the character is aware this is a candid conversation, not a scene."
    ),
    "author": (
        "This is an author-assistant conversation. You are a skilled writing "
        "assistant discussing the character and world WITH the user, not "
        "roleplaying. Analyze, critique, and suggest ideas about the character, "
        "referencing the profile, memories, and scene context provided."
    ),
}

MULTI_CHARACTER_RULES = (
    "Multiple characters are present in this scene. Rules:\n"
    "- Only speak for the listed characters, never for the user.\n"
    "- Exactly one character responds per assistant turn.\n"
    "- Begin with that character's name in curly brackets, e.g. '{Daniela}'.\n"
    "- Keep each character's voice distinct, following their profiles.\n"
    "- When a next responder is explicitly selected, only that character responds."
)

def sprite_instruction(sprites: dict[str, str], speaker_name: str = "") -> str:
    choices = ", ".join(f"[{call_sign}] ({name})" for call_sign, name in sprites.items())
    example = next(iter(sprites))
    prefix = f"Immediately after {{{speaker_name}}}, put" if speaker_name else "Begin every reply with"
    return (
        f"{prefix} exactly one sprite call sign in square brackets, "
        f"chosen from this list: {choices}. Choose the sprite that best matches the "
        "character's current emotion or action. Follow the tag with the response "
        "itself. Example: "
        f"{'{' + speaker_name + '}' if speaker_name else ''}[{example}] \"...\""
    )

NARRATOR_INSTRUCTION = (
    "You may also act as a scene narrator: between pieces of dialogue, write "
    "brief narration describing the surroundings, atmosphere, and the "
    "character's actions. Write all narration in italics using asterisks, "
    "*like this*. Keep narration short and evocative; dialogue carries the scene."
)

NO_NARRATOR_INSTRUCTION = (
    "Do not write standalone scene narration paragraphs; stay with the "
    "character's dialogue and brief inline action beats."
)

_SPRITE_RE = re.compile(r"^\s*\[(?P<emotion>[^\[\]\r\n]{1,64})\]\s*")


def parse_emotion(text: str, call_signs=None) -> tuple[str, str]:
    """Split a leading [emotion] tag off a reply. Returns (emotion, rest)."""
    m = _SPRITE_RE.match(text)
    if m:
        found = m.group("emotion").strip().lower()
        allowed = {x.lower() for x in call_signs} if call_signs is not None else None
        if allowed is None or found in allowed:
            return found, text[m.end():]
    return "", text


@dataclass
class PromptSection:
    label: str
    content: str


@dataclass
class BuiltPrompt:
    sections: list[PromptSection] = field(default_factory=list)
    messages: list[dict] = field(default_factory=list)  # final payload messages

    @property
    def system_text(self) -> str:
        return "\n\n".join(
            f"## {s.label}\n{s.content}" for s in self.sections if s.content.strip()
        )


def _block(*pairs: tuple[str, str]) -> str:
    lines = []
    for label, value in pairs:
        value = (value or "").strip()
        if value:
            lines.append(f"{label}: {value}" if "\n" not in value else f"{label}:\n{value}")
    return "\n".join(lines)


def build_world_section(world: World) -> str:
    return _block(
        ("World name", world.name),
        ("Genre", world.genre),
        ("Tone", world.tone),
        ("Summary", world.summary),
        ("Setting description", world.setting_description),
        ("Style guide", world.style_guide),
    )


def build_character_section(char: Character) -> str:
    return _block(
        ("Name", char.name),
        ("Nicknames", char.nicknames),
        ("Age", char.age),
        ("Role/archetype", char.role),
        ("Summary", char.summary),
        ("Appearance", char.appearance),
        ("Personality", char.personality),
        ("Backstory", char.backstory),
        ("Behavior rules", char.behavior_rules),
        ("Voice and dialogue style", char.voice_style),
        ("Relationship to the user", char.relationship_to_user),
        ("Extra AI instructions", char.ai_instructions),
    )


def build_memory_section(character_name: str, memories: list[Memory]) -> str:
    canon = [m.content for m in memories if m.type == "canon"]
    relationship = [m.content for m in memories if m.type == "relationship"]
    parts = []
    if canon:
        parts.append(
            f"Canon facts about {character_name} (established and permanently true):\n"
            + "\n".join(f"- {c}" for c in canon)
        )
    if relationship:
        parts.append(
            f"How {character_name} currently feels about the user:\n"
            + "\n".join(f"- {r}" for r in relationship)
        )
    return "\n\n".join(parts)


def build_scene_section(scene: Scene) -> str:
    pairs = [("Scene premise", scene.premise)]
    pairs.extend(
        [
            ("Time of day", scene.time_of_day),
            ("Tone", scene.tone),
            ("Current relationship status", scene.relationship_status),
        ]
    )
    return _block(*pairs)


def match_lore(
    entries: list[LoreEntry], scene: Scene, history: list[Message], recent: int = 10
) -> list[tuple[LoreEntry, str]]:
    """Select lore entries relevant to the scene.

    Returns (entry, reason) pairs: always-include entries plus entries whose
    keywords appear in the premise or the last `recent` messages.
    """
    haystack_parts = [scene.premise, scene.title]
    haystack_parts += [
        m.content for m in history[-recent:] if not m.is_deleted and m.role != "system-note"
    ]
    haystack = " ".join(haystack_parts).lower()

    matches: list[tuple[LoreEntry, str]] = []
    for entry in entries:
        if entry.always_include:
            matches.append((entry, "always included"))
            continue
        for kw in (k.strip().lower() for k in entry.keywords.split(",")):
            if kw and kw in haystack:
                matches.append((entry, f'matched keyword "{kw}"'))
                break
    return matches


def build_prompt(
    world: World,
    characters: list[Character],
    scene: Scene,
    memories_by_char: dict[int, list[Memory]],
    lore_matches: list[tuple[LoreEntry, str]],
    persona: Persona | None,
    history: list[Message],
    history_limit: int = 30,
    emotion_tags: bool = False,
    sprites: dict[str, str] | None = None,
    responder: Character | None = None,
    respond_to_latest: bool = False,
    system_prompt: str = "",
) -> BuiltPrompt:
    built = BuiltPrompt()
    multi = len(characters) > 1
    mode = scene.mode if scene.mode in MODE_INSTRUCTIONS else "roleplay"

    if system_prompt.strip():
        built.sections.append(PromptSection("Custom system prompt", system_prompt.strip()))

    names = ", ".join(f'"{c.name}"' for c in characters)
    core_parts = [
        (
            f"You are playing the character{'s' if multi else ''} {names} in the "
            f"world \"{world.name}\".\n{MODE_INSTRUCTIONS[mode]}"
        )
    ]
    if multi:
        core_parts.append(MULTI_CHARACTER_RULES)
        if responder is not None:
            core_parts.append(
                f'For the next reply, only "{responder.name}" may respond. Begin the '
                f'reply with {{{responder.name}}}, followed by the emotion tag.'
            )
            if respond_to_latest:
                core_parts.append(
                    f'"{responder.name}" must respond directly and naturally to the '
                    "latest assistant reply. Continue the exchange without waiting "
                    "for or inventing a user message."
                )
    if mode == "roleplay":
        core_parts.append(
            NARRATOR_INSTRUCTION if scene.narrator_enabled else NO_NARRATOR_INSTRUCTION
        )
    if emotion_tags and sprites and mode != "author":
        core_parts.append(sprite_instruction(sprites, responder.name if multi and responder else ""))
    built.sections.append(PromptSection("System instructions", "\n\n".join(core_parts)))

    built.sections.append(PromptSection("World", build_world_section(world)))

    for char in characters:
        label = "Character profile" if not multi else f"Character profile: {char.name}"
        built.sections.append(PromptSection(label, build_character_section(char)))

    for char in characters:
        mem_text = build_memory_section(char.name, memories_by_char.get(char.id, []))
        if mem_text:
            label = "Memories" if not multi else f"Memories: {char.name}"
            built.sections.append(PromptSection(label, mem_text))

    if lore_matches:
        lore_text = "\n\n".join(
            f"### {entry.title} ({reason})\n{entry.content}"
            for entry, reason in lore_matches
        )
        built.sections.append(PromptSection("Relevant lore", lore_text))

    if persona:
        built.sections.append(
            PromptSection(
                "User persona",
                f"In this scene the user is: {persona.name}\n{persona.description}".strip(),
            )
        )

    built.sections.append(PromptSection("Scene", build_scene_section(scene)))

    visible = [m for m in history if not m.is_deleted and m.role != "system-note"]
    truncated = len(visible) > history_limit
    window = visible[-history_limit:] if truncated else visible

    if truncated and scene.summary.strip():
        built.sections.append(
            PromptSection("Earlier in this scene (summary)", scene.summary.strip())
        )

    built.messages.append({"role": "system", "content": built.system_text})
    for msg in window:
        if msg.role == "user":
            built.messages.append({"role": "user", "content": msg.content})
        else:  # character or narrator replies both come from the assistant
            content = msg.content
            if emotion_tags and msg.emotion:
                content = f"[{msg.emotion}] {content}"
            built.messages.append({"role": "assistant", "content": content})
    return built


def build_summary_prompt(
    characters: list[Character], scene: Scene, history: list[Message]
) -> list[dict]:
    """Prompt asking the model to summarize the scene so far."""
    single_name = characters[0].name if len(characters) == 1 else None
    lines = []
    for m in history:
        if m.is_deleted or m.role == "system-note":
            continue
        if m.role == "user":
            lines.append(f"User: {m.content}")
        elif single_name:
            lines.append(f"{single_name}: {m.content}")
        else:  # multi-character replies already carry name labels
            lines.append(m.content)
    transcript = "\n".join(lines)
    system = (
        "You are a helpful writing assistant. Summarize the scene transcript "
        "below in a compact way that preserves everything important: key events, "
        "emotional shifts, revelations, promises, and changes in the relationship. "
        "Write it as a short list of plain factual sentences. Do not invent details."
    )
    user = f"Scene premise: {scene.premise or '(none)'}\n\nTranscript:\n{transcript}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def build_impersonation_prompt(
    context: BuiltPrompt, persona: Persona, draft: str = ""
) -> list[dict]:
    """Build a one-shot request for the persona's suggested next turn."""
    context_sections = [
        section for section in context.sections
        if section.label not in {"System instructions", "Custom system prompt"}
    ]
    background = "\n\n".join(
        f"## {section.label}\n{section.content}"
        for section in context_sections if section.content.strip()
    )
    system = (
        "You are helping the user roleplay as their persona. Write one possible "
        f"next turn for {persona.name}, the USER persona—not for any character. "
        "Infer a natural response from the persona description, scene context, and "
        "conversation. Include what the persona says and, when natural, a brief "
        "action in roleplay prose. Never decide major irreversible actions for the "
        "user. Output only the suggested turn: no explanation, no speaker label, "
        "no quotation wrapper around the whole response, and no sprite call sign."
    )
    if background:
        system += "\n\n" + background
    messages = [{"role": "system", "content": system}]
    messages.extend(context.messages[1:])
    request = "Suggest the user persona's next turn now."
    if draft.strip():
        request += f" Use this unfinished draft as optional guidance:\n{draft.strip()}"
    messages.append({"role": "user", "content": request})
    return messages


CONTINUE_INSTRUCTION = (
    "[OOC: Your reply above was cut off. Continue it from exactly where it "
    "stops, even if that is mid-sentence, keeping the same voice, tense, and "
    "formatting. Output ONLY the continuation: do not repeat any text already "
    "written, do not restart the reply, do not add a speaker label or sprite "
    "call sign, and do not comment on this instruction. Include a leading "
    "space or line break if the existing text needs one.]"
)


def build_continuation_prompt(context: BuiltPrompt, partial: str) -> list[dict]:
    """Ask the model to finish a partial character reply.

    `context.messages` must end with the history *before* the reply being
    continued; the partial text is appended as the last assistant turn.
    """
    messages = list(context.messages)
    messages.append({"role": "assistant", "content": partial})
    messages.append({"role": "user", "content": CONTINUE_INSTRUCTION})
    return messages


def build_notes_chat_prompt(
    world: World,
    notes: list[WorldNote],
    history: list[NoteChatMessage],
    inclusion_reasons: dict[int, str] | None = None,
    proposal_ledger: list[dict] | None = None,
) -> list[dict]:
    """Prompt for the worldbuilding notes workspace assistant."""
    system_parts = [
        "You are a thoughtful worldbuilding and writing assistant helping the "
        "user develop their fictional world. You are NOT roleplaying a "
        "character; this is a craft conversation between collaborators. "
        "Brainstorm, ask probing questions, point out contradictions, gaps, "
        "and untapped potential in the notes, and suggest concrete directions. "
        "Respect the user's creative ownership: build on their ideas rather "
        "than replacing them. When asked to revise or draft a note, output "
        "text the user can paste directly into it. The notes below are the "
        "user's private working notes - treat them as drafts, not fixed canon.",
        (
            "When a concrete note action would help, you may append a fenced "
            "`note_action` JSON block after your normal reply. Put exactly one "
            "JSON object in each block using this form:\n"
            "```note_action\n"
            '{"type":"create","title":"Title","category":"Characters",'
            '"content":"Draft text","context_mode":"relevant","is_pinned":false}\n'
            "```\nSupported types "
            "are open, append, replace, and create. For open/append/replace use "
            "a listed integer note_id. For append/replace include `content`. "
            "For create include title, category, content, context_mode, and "
            "is_pinned. Valid categories are Characters, Setting, Plot, and "
            "Unsorted. Valid context_mode values are always, relevant, and "
            "excluded. Do not wrap actions in an array or a generic `json` fence. "
            "Never claim an action happened; the user must review it."
        ),
        "## World\n" + (build_world_section(world) or "(no details yet)"),
    ]
    reasons = inclusion_reasons or {}
    if notes:
        blocks = []
        for index, note in enumerate(notes, start=1):
            title = note.title.strip() or f"Untitled note {index}"
            reason = reasons.get(note.id, "included")
            content = note.content.strip() or "(empty)"
            blocks.append(
                f"[{note.category} Note id={note.id}: {title} — {reason}]\n{content}"
            )
        notes_text = "\n\n".join(blocks)
    else:
        notes_text = "(No notes are included for this message.)"
    system_parts.append(
        "## Worldbuilding notes selected for this message\n" + notes_text
    )
    if proposal_ledger:
        proposal_lines = []
        for proposal in proposal_ledger:
            payload = proposal.get("payload", {})
            note_id = proposal.get("target_note_id")
            note_status = proposal.get("lifecycle_status") or "missing"
            proposal_status = proposal.get("status") or "unknown"
            action_type = proposal.get("action_type", "")
            stored_content = proposal.get("note_content") or ""
            if proposal.get("status") == "pending" and action_type == "replace":
                displayed_content = payload.get("content", stored_content)
            elif proposal.get("status") == "pending" and action_type == "append":
                displayed_content = (
                    stored_content.rstrip() + "\n\n"
                    + str(payload.get("content", "")).strip()
                )
            else:
                displayed_content = stored_content or payload.get("content", "")
            proposal_lines.append(
                f"[Workspace Note id={note_id} · note_status={note_status} · "
                f"proposal_status={proposal_status}]\n"
                f"Proposal record: {proposal['id']}\n"
                f"Last action: {action_type}\n"
                f"Title: {proposal.get('note_title') or payload.get('title', '')}\n"
                f"Category: "
                f"{proposal.get('note_category') or payload.get('category', '')}\n"
                f"Stored provisional content:\n"
                f"{displayed_content}"
            )
        system_parts.append(
            "## Workspace proposal ledger\n"
            "These entries have real stable note IDs. note_status describes the "
            "stored note; proposal_status describes the unapproved action. Proposed "
            "replacement or appended content is never canonical until the user "
            "approves it, even when note_status is canonical. You may use listed "
            "note_id values with replace, append, or open; never guess an ID. A "
            "rejected note remains available for revision during this chat. A new "
            "create action is only for a genuinely different note. After you emit a "
            "create action, its allocated ID will appear in the next prompt.\n\n"
            + "\n\n".join(proposal_lines)
        )
    messages = [{"role": "system", "content": "\n\n".join(system_parts)}]
    for message in history:
        role = "user" if message.role == "user" else "assistant"
        messages.append({"role": role, "content": message.content})
    return messages


def build_memory_suggestion_prompt(
    characters: list[Character], scene: Scene, history: list[Message]
) -> list[dict]:
    """Prompt asking the model to propose canon/relationship memories."""
    single_name = characters[0].name if len(characters) == 1 else None
    lines = []
    for m in history:
        if m.is_deleted or m.role == "system-note":
            continue
        if m.role == "user":
            lines.append(f"User: {m.content}")
        elif single_name:
            lines.append(f"{single_name}: {m.content}")
        else:
            lines.append(m.content)
    transcript = "\n".join(lines)
    names = ", ".join(c.name for c in characters)
    system = (
        "You are a helpful writing assistant. Read the scene transcript and "
        "propose the most important facts worth remembering permanently about "
        f"the character(s): {names}. Focus on revelations, promises, decisions, "
        "relationship changes, and new canon details. Write ONLY a plain list, "
        "one fact per line, each line starting with '- '. Each fact must be a "
        "single self-contained sentence naming the character it is about. "
        "Propose at most 6 facts. Do not invent anything not in the transcript."
    )
    user = f"Scene premise: {scene.premise or '(none)'}\n\nTranscript:\n{transcript}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
