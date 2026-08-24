-- Version 2.
--
-- Scenes: tone, time of day and relationship status are gone — the world
-- carries tone, the character carries the relationship, and the time of day
-- belongs in the prose. The premise is replaced by an explicit title plus a
-- "previously on" field holding summaries of earlier scenes.
--
-- Memories: the two-state approved/pending column is replaced by the notes
-- lifecycle, so a proposal owns a real row with a stable id the model can
-- revise instead of a second contradicting fact appearing beside the old one.

ALTER TABLE scenes ADD COLUMN previously_on TEXT NOT NULL DEFAULT '';
ALTER TABLE scenes ADD COLUMN auto_summary_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scenes ADD COLUMN auto_memories_at INTEGER NOT NULL DEFAULT 0;

-- Nothing that still has text loses it: a premise becomes the title when there
-- is none, and otherwise survives as the scene's opening "previously on" entry.
UPDATE scenes SET title = premise WHERE trim(title) = '';
UPDATE scenes SET previously_on = premise
  WHERE trim(premise) <> '' AND trim(premise) <> trim(title);

ALTER TABLE scenes DROP COLUMN premise;
ALTER TABLE scenes DROP COLUMN tone;
ALTER TABLE scenes DROP COLUMN time_of_day;
ALTER TABLE scenes DROP COLUMN relationship_status;

ALTER TABLE scene_templates ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE scene_templates ADD COLUMN previously_on TEXT NOT NULL DEFAULT '';

UPDATE scene_templates SET title = premise WHERE trim(premise) <> '';

ALTER TABLE scene_templates DROP COLUMN premise;
ALTER TABLE scene_templates DROP COLUMN tone;
ALTER TABLE scene_templates DROP COLUMN time_of_day;
ALTER TABLE scene_templates DROP COLUMN relationship_status;

-- ---------------------------------------------------------------- memories

ALTER TABLE memories ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'canonical';
UPDATE memories SET lifecycle_status = 'proposed' WHERE status = 'pending';

DROP INDEX idx_memories_character;
ALTER TABLE memories DROP COLUMN status;
CREATE INDEX idx_memories_character ON memories(character_id, lifecycle_status);

CREATE TABLE memory_suggestions (
  id INTEGER PRIMARY KEY,
  scene_id INTEGER REFERENCES scenes(id) ON DELETE SET NULL,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('create', 'replace', 'forget')),
  target_memory_id INTEGER REFERENCES memories(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_memory_suggestions_scene ON memory_suggestions(scene_id, status);
CREATE INDEX idx_memory_suggestions_character ON memory_suggestions(character_id, status);

-- Memories already waiting for review become create-proposals so that nothing
-- a previous version proposed is stranded outside the review flow.
INSERT INTO memory_suggestions (scene_id, character_id, action_type, target_memory_id,
                                payload_json, status, created_at)
SELECT source_scene_id, character_id, 'create', id,
       json_object('content', content, 'memory_type', type), 'pending', created_at
FROM memories WHERE lifecycle_status = 'proposed';
