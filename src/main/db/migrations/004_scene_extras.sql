-- Version 4.
--
-- A scene has a cast, and it has extras.
--
-- The cast is everyone with a profile. The extras are the people the scene has
-- put within earshot and never characterised: the taxi driver, the barman, the
-- voice from the next table. Until now a turn could only be attributed to a
-- real character row, so a reply that opened with {Taxi driver} was not
-- recognised as a speaker at all — the tag stayed glued into the body of
-- whichever cast member happened to be answering.
--
-- An extra is not a character. It has no profile, no portrait, no sprites and
-- no memories, and giving it a characters row would put it in every picker and
-- hand it a Hub identity it has no business owning. What it needs is a name,
-- and the transcript is the right place to keep it: the turns carry the name,
-- so the extra stays consistent for as long as the scene keeps them and stops
-- being offered once they have fallen out of the history window.
--
-- The role CHECK has to be rebuilt to admit them, which SQLite can only do by
-- rebuilding the table. Nothing references messages(id), so this is a copy.

CREATE TABLE messages_new (
  id INTEGER PRIMARY KEY,
  scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  role TEXT NOT NULL
    CHECK (role IN ('user', 'character', 'extra', 'narrator', 'system-note')),
  character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  speaker_name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  emotion TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO messages_new (id, scene_id, role, character_id, content, emotion,
                          deleted_at, created_at)
SELECT id, scene_id, role, character_id, content, emotion, deleted_at, created_at
FROM messages;

DROP INDEX idx_messages_scene;
DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;
CREATE INDEX idx_messages_scene ON messages(scene_id, id);
