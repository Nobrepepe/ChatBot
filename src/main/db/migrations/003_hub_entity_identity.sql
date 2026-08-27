-- Version 3.
--
-- One row per Hub entity, for the life of the app.
--
-- Until now every activation imported a publication as a fresh set of rows with
-- fresh local ids, so the local id — the thing scenes, messages, memories and
-- notes all point at — was re-minted on every install. An updated character
-- became a different character, and everything hanging off the old one was
-- stranded: the scene still resolved, but its world had dropped out of the
-- canonical listings and there was no route back to it.
--
-- The Hub already hands us a permanent identity: the entity UUID in hub_id.
-- From here that is the app's identity too. A publication updates the row it
-- matches instead of replacing it, so continuity is structural rather than
-- something an import has to remember to carry across.
--
-- This migration collapses the duplicate rows already in the database, keeping
-- the earliest id of each entity as the survivor and its most recent content,
-- and repoints every reference. Entities the active publication no longer
-- carries are not deleted: they are retired, so old conversations keep them.

ALTER TABLE worlds ADD COLUMN retired_at TEXT;
ALTER TABLE characters ADD COLUMN retired_at TEXT;

-- ------------------------------------------------------------------ worlds

-- The copy whose content wins: the active publication's, else the newest.
CREATE TEMP TABLE world_source AS
SELECT hub_id, id FROM (
  SELECT id, hub_id,
         ROW_NUMBER() OVER (
           PARTITION BY hub_id
           ORDER BY (publication_id = (SELECT value FROM settings
                                       WHERE key = 'worldhubActivePublication')) DESC,
                    id DESC
         ) AS rn
  FROM worlds WHERE hub_id IS NOT NULL
) WHERE rn = 1;

-- The copy that survives: the earliest, so the oldest scenes need no change.
CREATE TEMP TABLE world_map AS
SELECT w.id AS old_id,
       (SELECT MIN(k.id) FROM worlds k WHERE k.hub_id = w.hub_id) AS new_id
FROM worlds w WHERE w.hub_id IS NOT NULL;

CREATE TEMP TABLE world_content AS
SELECT s.hub_id AS hub_id, w.name, w.genre, w.tone, w.summary, w.setting_description,
       w.style_guide, w.cover_image_path, w.session_background_path,
       w.publication_id, w.updated_at
FROM world_source s JOIN worlds w ON w.id = s.id;

UPDATE worlds SET
  name = c.name,
  genre = c.genre,
  tone = c.tone,
  summary = c.summary,
  setting_description = c.setting_description,
  style_guide = c.style_guide,
  cover_image_path = c.cover_image_path,
  session_background_path = c.session_background_path,
  publication_id = c.publication_id,
  updated_at = c.updated_at
FROM world_content c
WHERE c.hub_id = worlds.hub_id AND worlds.id IN (SELECT new_id FROM world_map);

-- --------------------------------------------------------------- locations

CREATE TEMP TABLE location_source AS
SELECT hub_id, id FROM (
  SELECT id, hub_id,
         ROW_NUMBER() OVER (
           PARTITION BY hub_id
           ORDER BY (publication_id = (SELECT value FROM settings
                                       WHERE key = 'worldhubActivePublication')) DESC,
                    id DESC
         ) AS rn
  FROM locations WHERE hub_id IS NOT NULL
) WHERE rn = 1;

CREATE TEMP TABLE location_map AS
SELECT l.id AS old_id,
       (SELECT MIN(k.id) FROM locations k WHERE k.hub_id = l.hub_id) AS new_id
FROM locations l WHERE l.hub_id IS NOT NULL;

CREATE TEMP TABLE location_content AS
SELECT s.hub_id AS hub_id, l.name, l.description, l.background_path, l.mood_tags,
       l.publication_id
FROM location_source s JOIN locations l ON l.id = s.id;

UPDATE locations SET
  name = c.name,
  description = c.description,
  background_path = c.background_path,
  mood_tags = c.mood_tags,
  publication_id = c.publication_id
FROM location_content c
WHERE c.hub_id = locations.hub_id AND locations.id IN (SELECT new_id FROM location_map);

-- -------------------------------------------------------------- characters

CREATE TEMP TABLE character_source AS
SELECT hub_id, id FROM (
  SELECT id, hub_id,
         ROW_NUMBER() OVER (
           PARTITION BY hub_id
           ORDER BY (publication_id = (SELECT value FROM settings
                                       WHERE key = 'worldhubActivePublication')) DESC,
                    id DESC
         ) AS rn
  FROM characters WHERE hub_id IS NOT NULL
) WHERE rn = 1;

CREATE TEMP TABLE character_map AS
SELECT c.id AS old_id,
       (SELECT MIN(k.id) FROM characters k WHERE k.hub_id = c.hub_id) AS new_id
FROM characters c WHERE c.hub_id IS NOT NULL;

CREATE TEMP TABLE character_content AS
SELECT s.hub_id AS hub_id, c.name, c.nicknames, c.age, c.role, c.summary, c.appearance,
       c.personality, c.backstory, c.behavior_rules, c.voice_style, c.relationship_to_user,
       c.ai_instructions, c.portrait_path, c.tile_image_path, c.publication_id, c.updated_at
FROM character_source s JOIN characters c ON c.id = s.id;

UPDATE characters SET
  name = c.name,
  nicknames = c.nicknames,
  age = c.age,
  role = c.role,
  summary = c.summary,
  appearance = c.appearance,
  personality = c.personality,
  backstory = c.backstory,
  behavior_rules = c.behavior_rules,
  voice_style = c.voice_style,
  relationship_to_user = c.relationship_to_user,
  ai_instructions = c.ai_instructions,
  portrait_path = c.portrait_path,
  tile_image_path = c.tile_image_path,
  publication_id = c.publication_id,
  updated_at = c.updated_at
FROM character_content c
WHERE c.hub_id = characters.hub_id AND characters.id IN (SELECT new_id FROM character_map);

-- ------------------------------------------------------------- lore entries

CREATE TEMP TABLE lore_source AS
SELECT hub_id, id FROM (
  SELECT id, hub_id,
         ROW_NUMBER() OVER (
           PARTITION BY hub_id
           ORDER BY (publication_id = (SELECT value FROM settings
                                       WHERE key = 'worldhubActivePublication')) DESC,
                    id DESC
         ) AS rn
  FROM lore_entries WHERE hub_id IS NOT NULL
) WHERE rn = 1;

CREATE TEMP TABLE lore_map AS
SELECT l.id AS old_id,
       (SELECT MIN(k.id) FROM lore_entries k WHERE k.hub_id = l.hub_id) AS new_id
FROM lore_entries l WHERE l.hub_id IS NOT NULL;

CREATE TEMP TABLE lore_content AS
SELECT s.hub_id AS hub_id, l.title, l.content, l.keywords_json, l.always_include,
       l.publication_id, l.updated_at
FROM lore_source s JOIN lore_entries l ON l.id = s.id;

UPDATE lore_entries SET
  title = c.title,
  content = c.content,
  keywords_json = c.keywords_json,
  always_include = c.always_include,
  publication_id = c.publication_id,
  updated_at = c.updated_at
FROM lore_content c
WHERE c.hub_id = lore_entries.hub_id AND lore_entries.id IN (SELECT new_id FROM lore_map);

-- ------------------------------------------------ repoint every reference

-- Rows that reference a world.
UPDATE characters SET world_id = (SELECT new_id FROM world_map WHERE old_id = characters.world_id)
  WHERE world_id IN (SELECT old_id FROM world_map WHERE old_id <> new_id);
UPDATE locations SET world_id = (SELECT new_id FROM world_map WHERE old_id = locations.world_id)
  WHERE world_id IN (SELECT old_id FROM world_map WHERE old_id <> new_id);
UPDATE scenes SET world_id = (SELECT new_id FROM world_map WHERE old_id = scenes.world_id)
  WHERE world_id IN (SELECT old_id FROM world_map WHERE old_id <> new_id);
UPDATE lore_entries SET world_id = (SELECT new_id FROM world_map WHERE old_id = lore_entries.world_id)
  WHERE world_id IN (SELECT old_id FROM world_map WHERE old_id <> new_id);
UPDATE scene_templates SET world_id = (SELECT new_id FROM world_map WHERE old_id = scene_templates.world_id)
  WHERE world_id IN (SELECT old_id FROM world_map WHERE old_id <> new_id);
UPDATE world_notes SET world_id = (SELECT new_id FROM world_map WHERE old_id = world_notes.world_id)
  WHERE world_id IN (SELECT old_id FROM world_map WHERE old_id <> new_id);
UPDATE world_notes_chat SET world_id = (SELECT new_id FROM world_map WHERE old_id = world_notes_chat.world_id)
  WHERE world_id IN (SELECT old_id FROM world_map WHERE old_id <> new_id);
UPDATE world_notes_workspace_sessions
  SET world_id = (SELECT new_id FROM world_map WHERE old_id = world_notes_workspace_sessions.world_id)
  WHERE world_id IN (SELECT old_id FROM world_map WHERE old_id <> new_id);

-- Rows that reference a location.
UPDATE scenes SET location_id = (SELECT new_id FROM location_map WHERE old_id = scenes.location_id)
  WHERE location_id IN (SELECT old_id FROM location_map WHERE old_id <> new_id);
UPDATE scene_templates SET location_id = (SELECT new_id FROM location_map WHERE old_id = scene_templates.location_id)
  WHERE location_id IN (SELECT old_id FROM location_map WHERE old_id <> new_id);

-- Rows that reference a character. The sprites of the losing copies go first,
-- so that moving the winning copy's sprites cannot collide on (character, call sign).
DELETE FROM character_sprites
  WHERE character_id IN (SELECT old_id FROM character_map)
    AND character_id NOT IN (SELECT id FROM character_source);
UPDATE character_sprites
  SET character_id = (SELECT new_id FROM character_map WHERE old_id = character_sprites.character_id)
  WHERE character_id IN (SELECT old_id FROM character_map WHERE old_id <> new_id);

UPDATE messages SET character_id = (SELECT new_id FROM character_map WHERE old_id = messages.character_id)
  WHERE character_id IN (SELECT old_id FROM character_map WHERE old_id <> new_id);
UPDATE memories SET character_id = (SELECT new_id FROM character_map WHERE old_id = memories.character_id)
  WHERE character_id IN (SELECT old_id FROM character_map WHERE old_id <> new_id);
UPDATE memory_suggestions
  SET character_id = (SELECT new_id FROM character_map WHERE old_id = memory_suggestions.character_id)
  WHERE character_id IN (SELECT old_id FROM character_map WHERE old_id <> new_id);

-- The two link tables carry a composite primary key, so a remap can collide:
-- rebuild them through a grouped select instead of updating in place.
CREATE TEMP TABLE scene_characters_merged AS
SELECT sc.scene_id AS scene_id,
       COALESCE(m.new_id, sc.character_id) AS character_id,
       MIN(sc.sort_order) AS sort_order
FROM scene_characters sc LEFT JOIN character_map m ON m.old_id = sc.character_id
GROUP BY sc.scene_id, COALESCE(m.new_id, sc.character_id);
DELETE FROM scene_characters;
INSERT INTO scene_characters (scene_id, character_id, sort_order)
  SELECT scene_id, character_id, sort_order FROM scene_characters_merged;

CREATE TEMP TABLE scene_template_characters_merged AS
SELECT stc.template_id AS template_id,
       COALESCE(m.new_id, stc.character_id) AS character_id,
       MIN(stc.sort_order) AS sort_order
FROM scene_template_characters stc LEFT JOIN character_map m ON m.old_id = stc.character_id
GROUP BY stc.template_id, COALESCE(m.new_id, stc.character_id);
DELETE FROM scene_template_characters;
INSERT INTO scene_template_characters (template_id, character_id, sort_order)
  SELECT template_id, character_id, sort_order FROM scene_template_characters_merged;

-- ---------------------------------------------- drop the duplicate copies

-- Nothing references them any more, so no cascade reaches conversational data.
DELETE FROM lore_entries WHERE id IN (SELECT old_id FROM lore_map WHERE old_id <> new_id);
DELETE FROM characters WHERE id IN (SELECT old_id FROM character_map WHERE old_id <> new_id);
DELETE FROM locations WHERE id IN (SELECT old_id FROM location_map WHERE old_id <> new_id);
DELETE FROM worlds WHERE id IN (SELECT old_id FROM world_map WHERE old_id <> new_id);

-- --------------------------------------------------------------- retirement

-- Whatever the active publication no longer carries is retired rather than
-- removed: it stays fetchable by id, and stays out of the canonical listings.
UPDATE worlds SET retired_at = updated_at
  WHERE hub_id IS NOT NULL
    AND publication_id IS NOT (SELECT value FROM settings WHERE key = 'worldhubActivePublication');
UPDATE characters SET retired_at = updated_at
  WHERE hub_id IS NOT NULL
    AND publication_id IS NOT (SELECT value FROM settings WHERE key = 'worldhubActivePublication');

-- -------------------------------------------------- local keyword tuning

-- Keyword tuning followed the publication, so it reset on every update. It
-- belongs to the document, which now has one identity.
CREATE TABLE lore_keyword_overrides_new (
  hub_id TEXT PRIMARY KEY,
  keywords_json TEXT NOT NULL DEFAULT '[]'
);
INSERT INTO lore_keyword_overrides_new (hub_id, keywords_json)
SELECT hub_id, keywords_json FROM (
  SELECT hub_id, keywords_json,
         ROW_NUMBER() OVER (
           PARTITION BY hub_id
           ORDER BY (publication_id = (SELECT value FROM settings
                                       WHERE key = 'worldhubActivePublication')) DESC,
                    rowid DESC
         ) AS rn
  FROM lore_keyword_overrides
) WHERE rn = 1;
DROP TABLE lore_keyword_overrides;
ALTER TABLE lore_keyword_overrides_new RENAME TO lore_keyword_overrides;

-- ------------------------------------------------------ the new invariant

-- These were plain lookup indexes, and the character one led with the
-- publication. Identity is the hub id alone, and it is now unique.
DROP INDEX idx_worlds_hub;
DROP INDEX idx_characters_hub;
CREATE UNIQUE INDEX idx_worlds_hub ON worlds(hub_id) WHERE hub_id IS NOT NULL;
CREATE UNIQUE INDEX idx_characters_hub ON characters(hub_id) WHERE hub_id IS NOT NULL;
CREATE UNIQUE INDEX idx_locations_hub ON locations(hub_id) WHERE hub_id IS NOT NULL;
CREATE UNIQUE INDEX idx_lore_entries_hub ON lore_entries(hub_id) WHERE hub_id IS NOT NULL;

DROP TABLE world_source;
DROP TABLE world_map;
DROP TABLE world_content;
DROP TABLE location_source;
DROP TABLE location_map;
DROP TABLE location_content;
DROP TABLE character_source;
DROP TABLE character_map;
DROP TABLE character_content;
DROP TABLE lore_source;
DROP TABLE lore_map;
DROP TABLE lore_content;
DROP TABLE scene_characters_merged;
DROP TABLE scene_template_characters_merged;
