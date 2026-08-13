"""Image asset importing: copies files into assets/ and returns relative paths.

Flet serves files from the assets dir, so UI code can use the returned
relative path directly as an Image src.
"""

import re
import shutil
from pathlib import Path

from ..database import ASSETS_DIR


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return slug or "unnamed"


def _import_file(src: str, dest_dir: Path) -> str:
    src_path = Path(src)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / src_path.name
    # Avoid overwriting a different file with the same name.
    counter = 1
    while dest.exists():
        if dest.samefile(src_path):
            return str(dest.relative_to(ASSETS_DIR))
        dest = dest_dir / f"{src_path.stem}_{counter}{src_path.suffix}"
        counter += 1
    shutil.copy2(src_path, dest)
    return str(dest.relative_to(ASSETS_DIR))


def import_background(src: str, world_name: str) -> str:
    dest = ASSETS_DIR / "worlds" / slugify(world_name) / "backgrounds"
    return _import_file(src, dest)


def import_world_cover(src: str, world_name: str) -> str:
    dest = ASSETS_DIR / "worlds" / slugify(world_name) / "covers"
    return _import_file(src, dest)


def import_session_background(src: str, world_name: str) -> str:
    dest = ASSETS_DIR / "worlds" / slugify(world_name) / "session_backgrounds"
    return _import_file(src, dest)


def import_portrait(src: str, world_name: str, character_name: str) -> str:
    dest = (
        ASSETS_DIR / "worlds" / slugify(world_name)
        / "characters" / slugify(character_name)
    )
    return _import_file(src, dest)


def import_character_tile(src: str, world_name: str, character_name: str) -> str:
    """Import a character's compact 16:9 identification image."""
    return import_portrait(src, world_name, character_name)


def asset_abs_path(rel_path: str) -> Path:
    return ASSETS_DIR / rel_path
