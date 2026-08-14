"""World Hub consumer for ChatBot.

Each activated publication is imported as its own immutable set of
canonical rows (worlds, locations, characters, sprites, lore). Scenes
pin the publication that was active when they began, so existing
conversations keep their exact canon and retired characters stay
visible in old conversations. All conversational and private data —
scenes, messages, memories, personas, notes, settings — remains
app-owned and untouched by imports.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from dataclasses import dataclass, field as dataclass_field
from datetime import datetime, timezone
from pathlib import Path

from app import database, repository as repo
from app.database import get_conn
from app.worldhub.package_reader import (
    PackageError,
    PackageInfo,
    extract_zip_safely,
    load_package,
    read_current_pointer,
)

APP_TYPE = "chat-bot.cast"
LINKED_FOLDER_KEY = "worldhub_linked_folder"

# Paths are resolved lazily through the database module so tests (and a
# relocated data directory) always see the live values.
def content_dir() -> Path:
    return database.DATA_DIR / "worldhub-content"


def publications_dir() -> Path:
    return content_dir() / "publications"


def receipts_dir() -> Path:
    return content_dir() / "receipts"


def pointer_path() -> Path:
    return content_dir() / "current.json"


def media_root() -> Path:
    # Served media lives under the Flet assets dir, one folder per
    # publication, so pinned older scenes keep resolving their images.
    return database.ASSETS_DIR / "worldhub"


@dataclass
class UpdatePreview:
    publication_id: str
    production_name: str
    production_revision: int
    published_at: str
    added_worlds: list[str] = dataclass_field(default_factory=list)
    added_characters: list[str] = dataclass_field(default_factory=list)
    updated_characters: list[str] = dataclass_field(default_factory=list)
    retired_characters: list[str] = dataclass_field(default_factory=list)
    lore_documents: int = 0
    pinned_scenes: int = 0
    already_active: bool = False


@dataclass
class StagedPackage:
    package: PackageInfo
    staging_dir: Path
    source_type: str
    source_path: str

    def cleanup(self) -> None:
        shutil.rmtree(self.staging_dir, ignore_errors=True)


def _tmp_root() -> Path:
    tmp = content_dir() / "tmp"
    tmp.mkdir(parents=True, exist_ok=True)
    return tmp


def _semantic_validation(package: PackageInfo) -> None:
    selections = package.content.get("selections") or {}
    if not selections.get("cb_worlds"):
        raise PackageError("The package selects no worlds.")
    if not selections.get("cast"):
        raise PackageError("The package selects no characters.")
    asset_sets = package.content.get("assetSets") or {}
    for character_id in selections.get("cast") or []:
        for sprite in asset_sets.get(f"sprites:{character_id}") or []:
            expression = (sprite.get("values") or {}).get("expression")
            if not expression or not str(expression).strip():
                raise PackageError("A sprite is missing its expression name.")


def stage_zip(zip_path: Path | str) -> StagedPackage:
    zip_path = Path(zip_path)
    staging = Path(tempfile.mkdtemp(prefix="worldhub-stage-", dir=str(_tmp_root())))
    try:
        extract_zip_safely(zip_path, staging)
        package = load_package(staging, APP_TYPE)
        _semantic_validation(package)
        return StagedPackage(package, staging, "zip", str(zip_path))
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def stage_linked_folder(production_dir: Path | str | None = None) -> StagedPackage:
    production_dir = Path(production_dir) if production_dir else linked_folder()
    if production_dir is None:
        raise PackageError("No World Hub production folder is linked.")
    pointer = read_current_pointer(production_dir)
    if pointer is None:
        raise PackageError("The linked folder has no readable current.json pointer.")
    source = production_dir / "publications" / pointer["publicationId"]
    if not source.is_dir():
        raise PackageError("The linked folder's active publication is missing.")
    staging = Path(tempfile.mkdtemp(prefix="worldhub-stage-", dir=str(_tmp_root())))
    try:
        shutil.copytree(source, staging, dirs_exist_ok=True)
        package = load_package(staging, APP_TYPE)
        _semantic_validation(package)
        return StagedPackage(package, staging, "folder", str(production_dir))
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def link_folder(production_dir: Path | str) -> None:
    production_dir = Path(production_dir)
    if read_current_pointer(production_dir) is None:
        raise PackageError("That folder is not a World Hub production folder (no current.json).")
    repo.save_setting(LINKED_FOLDER_KEY, str(production_dir))


def linked_folder() -> Path | None:
    raw = repo.get_settings().get(LINKED_FOLDER_KEY, "")
    return Path(raw) if raw else None


def status() -> dict:
    active = repo.active_publication_id()
    receipt = None
    if active:
        try:
            receipt = json.loads((receipts_dir() / f"{active}.json").read_text("utf-8"))
        except (OSError, json.JSONDecodeError):
            receipt = None
    pointer = read_current_pointer(content_dir()) if pointer_path().exists() else None
    return {
        "hub_mode": active is not None,
        "publication_id": active,
        "receipt": receipt,
        "previous_publication_id": (pointer or {}).get("previousPublicationId"),
        "linked_folder": str(linked_folder() or ""),
    }


def preview(staged: StagedPackage) -> UpdatePreview:
    package = staged.package
    entities = package.entities_by_id()
    selections = package.content.get("selections") or {}
    result = UpdatePreview(
        publication_id=package.publication_id,
        production_name=package.manifest["production"]["name"],
        production_revision=package.manifest["production"]["revision"],
        published_at=package.manifest["publishedAt"],
        lore_documents=len(package.documents),
        already_active=package.publication_id == repo.active_publication_id(),
    )
    with get_conn() as conn:
        known_worlds = {r["hub_id"] for r in conn.execute(
            "SELECT DISTINCT hub_id FROM worlds WHERE hub_id IS NOT NULL")}
        known_characters = {r["hub_id"] for r in conn.execute(
            "SELECT DISTINCT hub_id FROM characters WHERE hub_id IS NOT NULL")}
        result.pinned_scenes = conn.execute(
            "SELECT COUNT(*) AS n FROM scenes WHERE publication_id IS NOT NULL"
        ).fetchone()["n"]
    for world_id in selections.get("cb_worlds") or []:
        if world_id not in known_worlds:
            result.added_worlds.append(entities.get(world_id, {}).get("name", world_id))
    cast_ids = set(selections.get("cast") or [])
    for character_id in cast_ids:
        name = entities.get(character_id, {}).get("name", character_id)
        (result.updated_characters if character_id in known_characters
         else result.added_characters).append(name)
    active = repo.active_publication_id()
    if active:
        with get_conn() as conn:
            rows = conn.execute(
                "SELECT name, hub_id FROM characters WHERE publication_id = ?", (active,)
            ).fetchall()
        for row in rows:
            if row["hub_id"] not in cast_ids:
                result.retired_characters.append(row["name"])
    return result


def activate(staged: StagedPackage) -> dict:
    """Import the staged package as a new canonical snapshot and switch to it."""
    package = staged.package
    publication_id = package.publication_id
    previous_active = repo.active_publication_id()
    media_dir = media_root() / publication_id

    try:
        with get_conn() as conn:
            _import_content(conn, package, publication_id, media_dir)
            conn.execute(
                """INSERT INTO settings (key, value) VALUES (?,?)
                   ON CONFLICT(key) DO UPDATE SET value=excluded.value""",
                (repo.ACTIVE_PUBLICATION_KEY, publication_id),
            )
        publications_dir().mkdir(parents=True, exist_ok=True)
        destination = publications_dir() / publication_id
        if not destination.exists():
            shutil.move(str(staged.staging_dir), str(destination))
        else:
            staged.cleanup()
        _write_receipt(package, staged)
        _write_pointer(publication_id, previous_active)
    except Exception:
        staged.cleanup()
        shutil.rmtree(media_dir, ignore_errors=True)
        raise
    return status()


def rollback() -> dict:
    pointer = read_current_pointer(content_dir())
    previous = (pointer or {}).get("previousPublicationId")
    if not previous:
        raise PackageError("There is no previous publication to roll back to.")
    source = publications_dir() / previous
    if not source.is_dir():
        raise PackageError("The previous publication's files are no longer available.")
    staging = Path(tempfile.mkdtemp(prefix="worldhub-stage-", dir=str(_tmp_root())))
    try:
        shutil.copytree(source, staging, dirs_exist_ok=True)
        package = load_package(staging, APP_TYPE)
        _semantic_validation(package)
        return activate(StagedPackage(package, staging, "rollback", str(source)))
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def check_for_update() -> UpdatePreview:
    staged = stage_linked_folder()
    try:
        return preview(staged)
    finally:
        staged.cleanup()


def migrate_scene(scene_id: int) -> None:
    """Explicitly move one conversation to the active publication's canon."""
    active = repo.active_publication_id()
    if active is None:
        raise PackageError("No World Hub publication is active.")
    with get_conn() as conn:
        scene = conn.execute("SELECT * FROM scenes WHERE id=?", (scene_id,)).fetchone()
        if scene is None:
            raise PackageError("That conversation no longer exists.")
        old_world = conn.execute(
            "SELECT hub_id FROM worlds WHERE id=?", (scene["world_id"],)
        ).fetchone()
        new_world = conn.execute(
            "SELECT id FROM worlds WHERE publication_id=? AND hub_id=?",
            (active, old_world["hub_id"] if old_world else None),
        ).fetchone()
        if new_world is None:
            raise PackageError("The conversation's world is not part of the active publication.")
        character_rows = conn.execute(
            "SELECT c.id, c.hub_id, c.name FROM scene_characters sc "
            "JOIN characters c ON c.id = sc.character_id WHERE sc.scene_id=?",
            (scene_id,),
        ).fetchall()
        replacements = []
        for row in character_rows:
            match = conn.execute(
                "SELECT id FROM characters WHERE publication_id=? AND hub_id=?",
                (active, row["hub_id"]),
            ).fetchone()
            if match is None:
                raise PackageError(
                    f"“{row['name']}” is not in the active publication; the conversation stays pinned."
                )
            replacements.append((row["id"], match["id"]))
        conn.execute(
            "UPDATE scenes SET world_id=?, publication_id=?, location_id=NULL WHERE id=?",
            (new_world["id"], active, scene_id),
        )
        for old_id, new_id in replacements:
            conn.execute(
                "UPDATE scene_characters SET character_id=? WHERE scene_id=? AND character_id=?",
                (new_id, scene_id, old_id),
            )


# -- import -----------------------------------------------------------------


def _copy_media(package: PackageInfo, media_dir: Path, asset_id: str | None,
                preferred: list[str]) -> str:
    """Copy one packaged file under the served assets dir; returns the
    relative path ChatBot stores, or '' when there is nothing to copy."""
    if not asset_id:
        return ""
    entry = package.asset_file(asset_id, preferred)
    if entry is None:
        return ""
    suffix = Path(entry["path"]).suffix
    target = media_dir / f"{asset_id}-{entry['recipeId']}{suffix}"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(package.absolute(entry["path"]), target)
    return str(target.relative_to(database.ASSETS_DIR))


def _import_content(conn, package: PackageInfo, publication_id: str, media_dir: Path) -> None:
    entities = package.entities_by_id()
    content = package.content
    selections = content.get("selections") or {}
    asset_sets = content.get("assetSets") or {}
    entity_values = content.get("entityValues") or {}
    world_profiles = {world["id"]: world for world in package.worlds}
    character_profiles = {character["id"]: character for character in package.characters}

    # Idempotent re-activation: this publication's rows are rebuilt.
    for table in ("lore_entries", "locations"):
        conn.execute(f"DELETE FROM {table} WHERE publication_id=?", (publication_id,))
    conn.execute(
        "DELETE FROM character_images WHERE character_id IN "
        "(SELECT id FROM characters WHERE publication_id=?)", (publication_id,))
    conn.execute("DELETE FROM characters WHERE publication_id=? AND id NOT IN "
                 "(SELECT character_id FROM scene_characters)", (publication_id,))
    conn.execute("DELETE FROM worlds WHERE publication_id=? AND id NOT IN "
                 "(SELECT world_id FROM scenes)", (publication_id,))

    world_local_ids: dict[str, int] = {}
    for hub_world_id in selections.get("cb_worlds") or []:
        entity = entities[hub_world_id]
        profile = world_profiles.get(hub_world_id, {})
        values = entity_values.get(hub_world_id) or {}
        cover = _copy_media(package, media_dir,
                            _set_asset(asset_sets, "cb_world_cover", hub_world_id),
                            ["landscape_16x9"])
        background = _copy_media(package, media_dir,
                                 _set_asset(asset_sets, "session_background", hub_world_id),
                                 ["landscape_16x9"])
        cur = conn.execute(
            """INSERT INTO worlds (name, genre, tone, summary, setting_description,
                                   style_guide, cover_image_path, session_background_path,
                                   hub_id, publication_id)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (entity["name"], profile.get("genre", ""), profile.get("tone", ""),
             entity.get("summary", ""), profile.get("settingDescription", ""),
             values.get("world_style_guide") or "", cover, background,
             hub_world_id, publication_id),
        )
        world_local_ids[hub_world_id] = cur.lastrowid

    for hub_place_id in selections.get("places") or []:
        entity = entities[hub_place_id]
        values = entity_values.get(hub_place_id) or {}
        world_local = world_local_ids.get(entity.get("worldId"))
        if world_local is None:
            continue
        background = _copy_media(package, media_dir,
                                 _set_asset(asset_sets, "location_background", hub_place_id),
                                 ["landscape_16x9"])
        conn.execute(
            """INSERT INTO locations (world_id, name, description, background_path,
                                      mood_tags, hub_id, publication_id)
               VALUES (?,?,?,?,?,?,?)""",
            (world_local, entity["name"], entity.get("summary", ""), background,
             values.get("loc_mood_tags") or "", hub_place_id, publication_id),
        )

    for hub_character_id in selections.get("cast") or []:
        entity = entities[hub_character_id]
        profile = character_profiles.get(hub_character_id, {})
        values = entity_values.get(hub_character_id) or {}
        world_local = world_local_ids.get(entity.get("worldId"))
        if world_local is None:
            raise PackageError("A character's world is not part of the package.")
        tile = _copy_media(package, media_dir,
                           _set_asset(asset_sets, "tile", hub_character_id),
                           ["square", "thumbnail_square"])
        cur = conn.execute(
            """INSERT INTO characters (world_id, name, nicknames, age, role, summary,
                                       appearance, personality, backstory, behavior_rules,
                                       voice_style, relationship_to_user, ai_instructions,
                                       tile_image_path, hub_id, publication_id)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (world_local, entity["name"], ", ".join(entity.get("aliases", [])),
             profile.get("age", ""), profile.get("role", ""), entity.get("summary", ""),
             profile.get("appearance", ""), profile.get("personality", ""),
             profile.get("biography", ""), values.get("char_behavior_rules") or "",
             profile.get("voice", ""), values.get("char_relationship_to_user") or "",
             values.get("char_ai_instructions") or "", tile,
             hub_character_id, publication_id),
        )
        local_character = cur.lastrowid
        portrait_asset = character_profiles.get(hub_character_id, {}).get("portraitAssetId")
        sprites = asset_sets.get(f"sprites:{hub_character_id}") or []
        neutral_written = False
        for sprite in sprites:
            expression = str((sprite.get("values") or {}).get("expression", "")).strip().lower()
            path = _copy_media(package, media_dir, sprite["assetId"], ["portrait_9x16"])
            if not path:
                continue
            conn.execute(
                """INSERT OR REPLACE INTO character_images
                   (character_id, expression, name, image_path) VALUES (?,?,?,?)""",
                (local_character, expression,
                 "Main portrait" if expression == "neutral" else expression.capitalize(),
                 path),
            )
            neutral_written = neutral_written or expression == "neutral"
        if not neutral_written and portrait_asset:
            path = _copy_media(package, media_dir, portrait_asset, ["portrait_9x16", "square"])
            if path:
                conn.execute(
                    """INSERT OR REPLACE INTO character_images
                       (character_id, expression, name, image_path) VALUES (?,?,?,?)""",
                    (local_character, "neutral", "Main portrait", path),
                )

    # Linked Hub Markdown replaces published lore entries for these worlds.
    for document in package.documents:
        body = package.absolute(document["path"]).read_text("utf-8")
        target_world = None
        for entity_id in document.get("entityIds", []):
            entity = entities.get(entity_id) or {}
            candidate = entity_id if entity.get("type") == "world" else entity.get("worldId")
            if candidate in world_local_ids:
                target_world = world_local_ids[candidate]
                break
        if target_world is None:
            continue
        conn.execute(
            """INSERT INTO lore_entries (world_id, title, content, keywords, always_include,
                                         hub_id, publication_id)
               VALUES (?,?,?,?,0,?,?)""",
            (target_world, document["title"], body, "", document["id"], publication_id),
        )


def _set_asset(asset_sets: dict, slot: str, entity_id: str) -> str | None:
    items = asset_sets.get(f"{slot}:{entity_id}") or []
    return items[0]["assetId"] if items else None


# -- receipts and pointer ----------------------------------------------------


def _write_receipt(package: PackageInfo, staged: StagedPackage) -> None:
    receipts_dir().mkdir(parents=True, exist_ok=True)
    manifest = package.manifest
    receipt = {
        "sourceLibraryId": manifest["sourceLibraryId"],
        "productionId": manifest["production"]["id"],
        "productionName": manifest["production"]["name"],
        "productionRevision": manifest["production"]["revision"],
        "publicationId": manifest["publicationId"],
        "applicationType": manifest["applicationType"],
        "contractId": manifest["contract"]["id"],
        "contractVersion": manifest["contract"]["version"],
        "publishedAt": manifest["publishedAt"],
        "importedAt": datetime.now(timezone.utc).isoformat(),
        "sourceType": staged.source_type,
        "sourcePath": staged.source_path,
        "packageFingerprint": package.checksums.get("manifest.json", ""),
    }
    _atomic_write(receipts_dir() / f"{package.publication_id}.json", json.dumps(receipt, indent=2))


def _write_pointer(publication_id: str, previous: str | None) -> None:
    pointer = {
        "publicationId": publication_id,
        "previousPublicationId": previous if previous != publication_id else None,
        "activatedAt": datetime.now(timezone.utc).isoformat(),
    }
    _atomic_write(pointer_path(), json.dumps(pointer, indent=2))


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        "w", dir=str(path.parent), prefix=".worldhub-tmp-", delete=False, encoding="utf-8"
    )
    try:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    finally:
        handle.close()
    os.replace(handle.name, path)
