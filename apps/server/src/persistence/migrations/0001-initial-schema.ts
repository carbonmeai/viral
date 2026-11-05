import { Effect } from "effect"
import { SqlClient } from "effect/sql"

// The Phase 0 schema, as designed in docs/plans/database-schema.md. SQLite prepares one statement
// at a time, so the script is split on statement boundaries.
const SCHEMA = `
  CREATE TABLE sources (
    id           TEXT PRIMARY KEY,                -- UUIDv7
    origin       TEXT NOT NULL,                   -- JSON: {"_tag":"Url","url":…} | {"_tag":"File","path":…}
    title        TEXT,                            -- from yt-dlp / file metadata once downloaded
    channel      TEXT,                            -- used for "Credit: <channel>" in descriptions
    url          TEXT,                            -- canonical link, when there is one
    duration_s   REAL,
    rights       TEXT NOT NULL DEFAULT 'unconfirmed'
                   CHECK (rights IN ('unconfirmed', 'owned', 'licensed')),
    rights_note  TEXT,                            -- e.g. licence reference
    created_at   TEXT NOT NULL,                   -- ISO-8601 UTC
    updated_at   TEXT NOT NULL
  );

  CREATE TABLE presets (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    config      TEXT NOT NULL,                    -- JSON Preset: canvas, voice id + words/sec, strip ads,
                                                  --   captions on/off, caption style + highlight colours, music levels
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE UNIQUE INDEX presets_one_default ON presets (is_default) WHERE is_default = 1;

  CREATE TABLE music_tracks (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    path         TEXT NOT NULL,                   -- relative to ~/.viral/music/
    duration_s   REAL,
    bpm          REAL,                            -- filled by analysis; null until analysed
    drop_s       REAL,                            -- where the drop hits inside the track
    analyzed_at  TEXT,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE projects (
    id              TEXT PRIMARY KEY,
    source_id       TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
    number          INTEGER NOT NULL,             -- 1, 2, 3… within the source; gives the "01-" slug prefix
    slug            TEXT NOT NULL,                -- "01-every-taste-candy"
    title           TEXT NOT NULL,
    format          TEXT NOT NULL CHECK (format IN ('narrated', 'cut-down')),
    preset_id       TEXT REFERENCES presets (id) ON DELETE SET NULL,     -- null = use the default preset
    music_track_id  TEXT REFERENCES music_tracks (id) ON DELETE SET NULL, -- optional; the music stage asks if missing
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,                -- for "last touched" sorting
    UNIQUE (source_id, number)
  );

  CREATE TABLE runs (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    status      TEXT NOT NULL
                  CHECK (status IN ('running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted')),
    from_stage  TEXT,                             -- set when resumed with --from <stage>
    error       TEXT,
    started_at  TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX runs_by_project ON runs (project_id, started_at);

  CREATE TABLE stage_runs (
    id               TEXT PRIMARY KEY,
    run_id           TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    stage            TEXT NOT NULL,               -- source | transcribe | contact-sheet | ads | story | script | sections
                                                  --   | voice | shots | music | render | metadata | thumbnail
    attempt          INTEGER NOT NULL DEFAULT 1,
    status           TEXT NOT NULL
                       CHECK (status IN ('running', 'waiting', 'succeeded', 'failed', 'cancelled', 'skipped', 'reused')),
                                                  -- reused = a source-level artifact already existed
    model            TEXT,                        -- agent stages: the model used
    agent_session_id TEXT,                        -- agent stages: Claude session id, for resume
    error            TEXT,
    -- cost, so we can measure what a short costs
    input_tokens     INTEGER,
    output_tokens    INTEGER,
    cost_usd         REAL,                        -- as reported by the Agent SDK
    tts_characters   INTEGER,                     -- ElevenLabs usage
    duration_ms      INTEGER,
    started_at       TEXT NOT NULL,
    finished_at      TEXT,
    UNIQUE (run_id, stage, attempt)
  );

  CREATE TABLE artifacts (
    id           TEXT PRIMARY KEY,
    source_id    TEXT REFERENCES sources (id) ON DELETE CASCADE,   -- video-level artifacts
    project_id   TEXT REFERENCES projects (id) ON DELETE CASCADE,  -- short-level artifacts
    stage_run_id TEXT REFERENCES stage_runs (id) ON DELETE SET NULL,
    kind         TEXT NOT NULL,
                  -- source-level:  source-video | transcript | contact-sheet | ad-ranges
                  -- project-level: story-map | script | cut-plan | voiceover | voiceover-transcript
                  --                | narrated-plan | music-config | render | captions | metadata
                  --                | thumb-config | thumbnail
    version      INTEGER NOT NULL,                -- 1, 2, 3… per owner and kind; regenerating adds a version
    data         TEXT,                            -- JSON for structured artifacts, decoded with the kind's schema
    path         TEXT,                            -- file artifacts: relative to the owner's folder
    created_at   TEXT NOT NULL,
    CHECK ((source_id IS NULL) <> (project_id IS NULL)),          -- exactly one owner
    CHECK (data IS NOT NULL OR path IS NOT NULL)
  );
  -- "current" artifact of a kind = highest version
  CREATE UNIQUE INDEX artifacts_source_versions  ON artifacts (source_id, kind, version)  WHERE source_id IS NOT NULL;
  CREATE UNIQUE INDEX artifacts_project_versions ON artifacts (project_id, kind, version) WHERE project_id IS NOT NULL;

  CREATE TABLE requests (
    id           TEXT PRIMARY KEY,
    run_id       TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    stage_run_id TEXT NOT NULL REFERENCES stage_runs (id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('approval', 'input')),
    title        TEXT NOT NULL,                   -- "Approve script?", "Pick a music track"
    payload      TEXT,                            -- JSON: what is being approved / which input is needed
    status       TEXT NOT NULL CHECK (status IN ('pending', 'answered', 'cancelled')),
    response     TEXT,                            -- JSON: {"approved":true} | {"musicTrackId":…} | {"skip":true}
    created_at   TEXT NOT NULL,
    answered_at  TEXT
  );
  CREATE INDEX requests_pending ON requests (created_at) WHERE status = 'pending';

  CREATE TABLE run_events (
    seq        INTEGER PRIMARY KEY AUTOINCREMENT, -- global order; clients resume with "after seq N"
    run_id     TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    event      TEXT NOT NULL,                     -- JSON JobEvent (stage-level only; see below)
    created_at TEXT NOT NULL
  );
  CREATE INDEX run_events_by_run ON run_events (run_id, seq);

  CREATE TABLE settings (
    key        TEXT PRIMARY KEY,                  -- e.g. "stage.story.model"
    value      TEXT NOT NULL,                     -- JSON
    updated_at TEXT NOT NULL
  );
`

const statements = SCHEMA.split(/;\s*\n/).map((statement) => statement.trim()).filter((statement) => statement !== "")

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  yield* Effect.forEach(statements, (statement) => sql.unsafe(statement), { discard: true })
})
