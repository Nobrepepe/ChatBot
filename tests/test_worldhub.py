"""World Hub consumer acceptance tests, driven by the shared fixtures."""

import json
import shutil
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from app import database, repository
from app.models import Memory, Persona, Scene, World
from app.worldhub import consumer_service as hub
from app.worldhub.package_reader import PackageError

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "worldhub"
EXPECTED = json.loads((FIXTURES / "expected.json").read_text())


class WorldHubTest(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        base = Path(self.tempdir.name)
        self.patches = [
            patch.object(database, "DB_PATH", base / "chatbot.db"),
            patch.object(database, "DATA_DIR", base / "data"),
            patch.object(database, "ASSETS_DIR", base / "assets"),
        ]
        for p in self.patches:
            p.start()
        (base / "data").mkdir()
        (base / "assets").mkdir()
        database.init_db()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tempdir.cleanup()

    def install(self, name: str):
        staged = hub.stage_zip(FIXTURES / name)
        return hub.activate(staged)

    # -- install -----------------------------------------------------------

    def test_install_imports_worlds_characters_and_lore(self):
        status = self.install("valid-v1.zip")
        self.assertTrue(status["hub_mode"])
        self.assertEqual(status["publication_id"], EXPECTED["publicationV1"])

        worlds = repository.list_worlds()
        self.assertEqual(len(worlds), 1)
        world = worlds[0]
        self.assertEqual(world.hub_id, EXPECTED["worldId"])
        self.assertTrue(world.genre, "canonical world profile imported")
        self.assertTrue(world.style_guide, "production style guide imported")

        characters = repository.list_characters(world.id)
        self.assertEqual(len(characters), len(EXPECTED["characterIds"]))
        for character in characters:
            self.assertTrue(character.personality, "canonical profile present")
            self.assertTrue(character.behavior_rules, "AI guidance imported from production values")
            images = repository.list_character_images(character.id)
            self.assertIn("neutral", images)

        lore = repository.list_lore_entries(world.id)
        self.assertEqual(len(lore), 1, "linked Hub Markdown became lore")
        self.assertIn("Accord", lore[0].title)

    def test_prompt_sections_match_publication(self):
        from app.prompt_builder import build_world_section, build_character_section
        self.install("valid-v1.zip")
        world = repository.list_worlds()[0]
        character = repository.list_characters(world.id)[0]
        world_text = build_world_section(world)
        character_text = build_character_section(character)
        self.assertIn(world.name, world_text)
        self.assertIn(character.personality.split(",")[0], character_text)
        self.assertIn("Never breaks character", character_text)

    # -- ownership boundary ------------------------------------------------

    def test_private_data_stays_local_across_updates(self):
        self.install("valid-v1.zip")
        world = repository.list_worlds()[0]
        persona_id = repository.save_persona(Persona(name="Me", description="The user"))
        character = repository.list_characters(world.id)[0]
        scene_id = repository.save_scene(Scene(
            world_id=world.id, title="First meeting", premise="A quiet cafe",
            character_ids=[character.id],
        ))
        repository.add_message(scene_id, "user", "Hello there")
        repository.save_memory(Memory(
            character_id=character.id, source_scene_id=scene_id,
            content="The user prefers tea.", status="approved",
        ))
        note_id = repository.save_world_note(__import__("app.models", fromlist=["WorldNote"]).WorldNote(
            world_id=world.id, title="Secret plan", content="Private notes stay local",
        ))

        self.install("valid-v2.zip")

        scene = repository.get_scene(scene_id)
        self.assertIsNotNone(scene)
        self.assertEqual(scene.publication_id, EXPECTED["publicationV1"], "scene stays pinned")
        self.assertEqual(len(repository.list_messages(scene_id)), 1)
        self.assertEqual(len(repository.list_memories(character.id)), 1)
        self.assertIsNotNone(repository.get_world_note(note_id))
        self.assertIsNotNone(repository.get_persona(persona_id))

    # -- pinning -----------------------------------------------------------

    def test_existing_scene_keeps_old_canon_and_new_scene_uses_new(self):
        self.install("valid-v1.zip")
        old_world = repository.list_worlds()[0]
        old_character = next(
            c for c in repository.list_characters(old_world.id)
            if c.hub_id == EXPECTED["renamedCharacterId"]
        )
        old_name = old_character.name
        scene_id = repository.save_scene(Scene(
            world_id=old_world.id, title="Pinned", character_ids=[old_character.id],
        ))

        self.install("valid-v2.zip")

        # The old scene resolves the exact rows it began with.
        pinned = repository.get_scene(scene_id)
        pinned_character = repository.get_character(pinned.character_ids[0])
        self.assertEqual(pinned_character.name, old_name)
        self.assertEqual(pinned_character.publication_id, EXPECTED["publicationV1"])

        # The active listing shows the new publication's rows.
        new_world = repository.list_worlds()[0]
        self.assertEqual(new_world.publication_id, EXPECTED["publicationV2"])
        new_names = [c.name for c in repository.list_characters(new_world.id)]
        self.assertTrue(any("Rekindled" in name for name in new_names))

        # Retired characters are not offered for new conversations.
        retired_hub = EXPECTED["retiredCharacterIds"][0]
        self.assertFalse(any(
            c.hub_id == retired_hub for c in repository.list_characters(new_world.id)
        ))
        # …but the old conversation still shows them.
        self.assertIsNotNone(repository.get_character(pinned.character_ids[0]))

    def test_migrate_scene_moves_to_active_canon_only_when_complete(self):
        self.install("valid-v1.zip")
        world = repository.list_worlds()[0]
        kept = next(c for c in repository.list_characters(world.id)
                    if c.hub_id == EXPECTED["renamedCharacterId"])
        retired = next(c for c in repository.list_characters(world.id)
                       if c.hub_id == EXPECTED["retiredCharacterIds"][0])
        migratable = repository.save_scene(Scene(world_id=world.id, character_ids=[kept.id]))
        blocked = repository.save_scene(Scene(world_id=world.id, character_ids=[retired.id]))

        self.install("valid-v2.zip")

        hub.migrate_scene(migratable)
        migrated = repository.get_scene(migratable)
        self.assertEqual(migrated.publication_id, EXPECTED["publicationV2"])
        self.assertEqual(
            repository.get_character(migrated.character_ids[0]).publication_id,
            EXPECTED["publicationV2"],
        )

        with self.assertRaises(PackageError):
            hub.migrate_scene(blocked)
        self.assertEqual(repository.get_scene(blocked).publication_id, EXPECTED["publicationV1"])

    # -- rollback and rejection --------------------------------------------

    def test_rollback_restores_previous_publication(self):
        self.install("valid-v1.zip")
        self.install("valid-v2.zip")
        status = hub.rollback()
        self.assertEqual(status["publication_id"], EXPECTED["publicationV1"])
        world = repository.list_worlds()[0]
        self.assertEqual(world.publication_id, EXPECTED["publicationV1"])

    def test_bad_packages_change_nothing(self):
        self.install("valid-v1.zip")
        world = repository.list_worlds()[0]
        character = repository.list_characters(world.id)[0]
        scene_id = repository.save_scene(Scene(world_id=world.id, character_ids=[character.id]))
        repository.add_message(scene_id, "user", "still here")

        for fixture in ["corrupt-checksum.zip", "unlisted-file.zip", "missing-asset.zip",
                        "wrong-apptype.zip", "unsupported-protocol.zip", "traversal.zip"]:
            with self.subTest(fixture=fixture):
                with self.assertRaises(PackageError):
                    self.install(fixture)
                self.assertEqual(hub.status()["publication_id"], EXPECTED["publicationV1"])
                self.assertEqual(len(repository.list_messages(scene_id)), 1,
                                 "conversation database untouched")

    # -- linked folder ------------------------------------------------------

    def test_linked_folder_update_flow(self):
        production_dir = Path(self.tempdir.name) / "production"
        with zipfile.ZipFile(FIXTURES / "valid-v2.zip") as archive:
            archive.extractall(production_dir / "publications" / EXPECTED["publicationV2"])
        (production_dir / "current.json").write_text(json.dumps({
            "publicationId": EXPECTED["publicationV2"],
        }))

        self.install("valid-v1.zip")
        hub.link_folder(production_dir)
        preview = hub.check_for_update()
        self.assertEqual(preview.publication_id, EXPECTED["publicationV2"])
        self.assertFalse(preview.already_active)
        self.assertTrue(preview.retired_characters)

        staged = hub.stage_linked_folder()
        status = hub.activate(staged)
        self.assertEqual(status["publication_id"], EXPECTED["publicationV2"])

        shutil.rmtree(production_dir)
        self.assertTrue(hub.status()["hub_mode"], "works offline from the installed cache")


if __name__ == "__main__":
    unittest.main()
