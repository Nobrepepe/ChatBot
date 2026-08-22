-- Character Chat schema, v1 (fresh start — no data migrated from the Flet app).

CREATE TABLE worlds (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  genre TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  setting_description TEXT NOT NULL DEFAULT '',
  style_guide TEXT NOT NULL DEFAULT '',
  cover_image_path TEXT NOT NULL DEFAULT '',
  session_background_path TEXT NOT NULL DEFAULT '',
  hub_id TEXT,
  publication_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE locations (
  id INTEGER PRIMARY KEY,
  world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  background_path TEXT NOT NULL DEFAULT '',
  mood_tags TEXT NOT NULL DEFAULT '',
  hub_id TEXT,
  publication_id TEXT
);

CREATE TABLE characters (
  id INTEGER PRIMARY KEY,
  world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  nicknames TEXT NOT NULL DEFAULT '',
  age TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  appearance TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  backstory TEXT NOT NULL DEFAULT '',
  behavior_rules TEXT NOT NULL DEFAULT '',
  voice_style TEXT NOT NULL DEFAULT '',
  relationship_to_user TEXT NOT NULL DEFAULT '',
  ai_instructions TEXT NOT NULL DEFAULT '',
  portrait_path TEXT NOT NULL DEFAULT '',
  tile_image_path TEXT NOT NULL DEFAULT '',
  hub_id TEXT,
  publication_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE character_sprites (
  id INTEGER PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Bare, lowercase, no brackets. Brackets exist only in the wire format.
  call_sign TEXT NOT NULL,
  image_path TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (character_id, call_sign)
);

CREATE TABLE personas (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE scenes (
  id INTEGER PRIMARY KEY,
  world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  premise TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT '',
  time_of_day TEXT NOT NULL DEFAULT '',
  relationship_status TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'roleplay' CHECK (mode IN ('roleplay', 'interview', 'author')),
  summary TEXT NOT NULL DEFAULT '',
  narrator_enabled INTEGER NOT NULL DEFAULT 0,
  persona_id INTEGER REFERENCES personas(id) ON DELETE SET NULL,
  publication_id TEXT,
  display_mode TEXT CHECK (display_mode IN ('chat', 'vn')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE scene_characters (
  scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (scene_id, character_id)
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  scene_id INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'character', 'narrator', 'system-note')),
  character_id INTEGER REFERENCES characters(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  emotion TEXT NOT NULL DEFAULT '',
  deleted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE memories (
  id INTEGER PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('canon', 'relationship', 'session')),
  content TEXT NOT NULL,
  source_scene_id INTEGER REFERENCES scenes(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'pending')),
  created_at TEXT NOT NULL
);

CREATE TABLE lore_entries (
  id INTEGER PRIMARY KEY,
  world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  keywords_json TEXT NOT NULL DEFAULT '[]',
  always_include INTEGER NOT NULL DEFAULT 0,
  hub_id TEXT,
  publication_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Local keyword tuning for hub-managed lore; hub rows themselves stay immutable.
CREATE TABLE lore_keyword_overrides (
  hub_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (hub_id, publication_id)
);

CREATE TABLE scene_templates (
  id INTEGER PRIMARY KEY,
  world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  premise TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT '',
  time_of_day TEXT NOT NULL DEFAULT '',
  relationship_status TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'roleplay' CHECK (mode IN ('roleplay', 'interview', 'author')),
  narrator_enabled INTEGER NOT NULL DEFAULT 0,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  persona_id INTEGER REFERENCES personas(id) ON DELETE SET NULL
);

CREATE TABLE scene_template_characters (
  template_id INTEGER NOT NULL REFERENCES scene_templates(id) ON DELETE CASCADE,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (template_id, character_id)
);

CREATE TABLE world_notes_workspace_sessions (
  id INTEGER PRIMARY KEY,
  world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  cleared_at TEXT
);

CREATE TABLE world_notes (
  id INTEGER PRIMARY KEY,
  world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Unsorted'
    CHECK (category IN ('Characters', 'Setting', 'Plot', 'Unsorted')),
  is_pinned INTEGER NOT NULL DEFAULT 0,
  context_mode TEXT NOT NULL DEFAULT 'relevant'
    CHECK (context_mode IN ('always', 'relevant', 'excluded')),
  last_opened_at TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'canonical'
    CHECK (lifecycle_status IN ('canonical', 'proposed', 'rejected', 'superseded')),
  workspace_session_id INTEGER REFERENCES world_notes_workspace_sessions(id) ON DELETE SET NULL,
  proposal_message_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE world_notes_chat (
  id INTEGER PRIMARY KEY,
  world_id INTEGER NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE world_note_prompt_usage (
  message_id INTEGER NOT NULL REFERENCES world_notes_chat(id) ON DELETE CASCADE,
  note_id INTEGER NOT NULL REFERENCES world_notes(id) ON DELETE CASCADE,
  note_fingerprint TEXT NOT NULL,
  inclusion_reason TEXT NOT NULL,
  PRIMARY KEY (message_id, note_id)
);

CREATE TABLE world_note_suggestions (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES world_notes_chat(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('open', 'create', 'append', 'replace')),
  target_note_id INTEGER REFERENCES world_notes(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  UNIQUE (message_id, ordinal)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_messages_scene ON messages(scene_id, id);
CREATE INDEX idx_scenes_world ON scenes(world_id, updated_at DESC);
CREATE INDEX idx_characters_world ON characters(world_id);
CREATE INDEX idx_memories_character ON memories(character_id, status);
CREATE INDEX idx_lore_world ON lore_entries(world_id);
CREATE INDEX idx_world_notes_world ON world_notes(world_id);
CREATE INDEX idx_worlds_hub ON worlds(hub_id);
CREATE INDEX idx_characters_hub ON characters(publication_id, hub_id);
