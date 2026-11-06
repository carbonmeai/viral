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

  CREATE TABLE reference_videos (
    id          TEXT PRIMARY KEY,
    url         TEXT NOT NULL,                    -- the viral video you want to learn from
    platform    TEXT,                             -- tiktok | youtube | instagram | …
    title       TEXT,
    creator     TEXT,
    duration_s  REAL,
    notes       TEXT,                             -- why you saved it
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE music_tracks (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    path          TEXT NOT NULL,                  -- relative to ~/.viral/music/
    origin        TEXT NOT NULL,                  -- JSON: {"_tag":"Upload","file":…} | {"_tag":"Url","url":…}
                                                  --   | {"_tag":"Bundled","plan":…}
    rights        TEXT NOT NULL DEFAULT 'unconfirmed'
                    CHECK (rights IN ('unconfirmed', 'owned', 'licensed')),
    kind          TEXT NOT NULL DEFAULT 'song' CHECK (kind IN ('song', 'clip')),  -- song: a raw song; clip: already edited
    reference_id  TEXT REFERENCES reference_videos (id) ON DELETE SET NULL,  -- imported from a reference video
    duration_s    REAL,
    bpm           REAL,                           -- filled by analysis; null until analysed
    drop_s        REAL,                           -- where the drop hits inside the track
    loudness_lufs REAL,
    beat_source   TEXT CHECK (beat_source IN ('analysis', 'manual')),  -- who set bpm/drop_s; manual is never overwritten
    analyzed_at   TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE sound_effects (
    id            TEXT PRIMARY KEY,
    category      TEXT NOT NULL,                  -- whoosh | pop | riser | impact | … (validated in contracts)
    name          TEXT NOT NULL,                  -- "whoosh-soft-02"
    path          TEXT NOT NULL,                  -- relative to ~/.viral/sounds/
    duration_s    REAL NOT NULL,
    loudness_lufs REAL,
    origin        TEXT NOT NULL,                  -- JSON: {"_tag":"Bundled"} | {"_tag":"Upload","file":…}
                                                  --   | {"_tag":"Generated","prompt":…,"settings":…}
    rights        TEXT NOT NULL DEFAULT 'licensed'
                    CHECK (rights IN ('unconfirmed', 'owned', 'licensed')),
    created_at    TEXT NOT NULL,
    UNIQUE (category, name)
  );
  CREATE INDEX sound_effects_by_category ON sound_effects (category);

  CREATE TABLE projects (
    id              TEXT PRIMARY KEY,
    source_id       TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
    number          INTEGER NOT NULL,             -- 1, 2, 3… within the source; gives the "01-" slug prefix
    slug            TEXT NOT NULL,                -- "01-every-taste-candy"
    title           TEXT NOT NULL,
    approach        TEXT NOT NULL,                -- question-recap | claim-interleaved | cut-down (validated in contracts)
    format          TEXT NOT NULL CHECK (format IN ('narrated', 'cut-down')),  -- derived from the approach
    preset_id       TEXT REFERENCES presets (id) ON DELETE SET NULL,     -- null = use the default preset
    music_track_id  TEXT REFERENCES music_tracks (id) ON DELETE SET NULL, -- optional; null = a voice-only short
    voice_id        TEXT,                         -- ElevenLabs voice id; null = the preset's voice
    brief           TEXT,                         -- what the short should achieve, in your words; steers its agents
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,                -- for "last touched" sorting
    UNIQUE (source_id, number)
  );

  CREATE TABLE runs (
    id          TEXT PRIMARY KEY,
    -- a source run (source → … → story) or a short's run; exactly one owner
    source_id   TEXT REFERENCES sources (id) ON DELETE CASCADE,
    project_id  TEXT REFERENCES projects (id) ON DELETE CASCADE,
    status      TEXT NOT NULL
                  CHECK (status IN ('running', 'waiting', 'completed', 'failed', 'cancelled', 'interrupted')),
    from_stage  TEXT,                             -- set when resumed with --from <stage>
    error       TEXT,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    CHECK ((source_id IS NULL) <> (project_id IS NULL))
  );
  CREATE INDEX runs_by_source ON runs (source_id, started_at) WHERE source_id IS NOT NULL;
  CREATE INDEX runs_by_project ON runs (project_id, started_at) WHERE project_id IS NOT NULL;

  CREATE TABLE stage_runs (
    id               TEXT PRIMARY KEY,
    run_id           TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    stage            TEXT NOT NULL,               -- source | transcribe | contact-sheet | ads | story | script | sections
                                                  --   | voice | shots | music | sound | render | metadata | thumbnail
    attempt          INTEGER NOT NULL DEFAULT 1,
    status           TEXT NOT NULL
                       CHECK (status IN ('running', 'waiting', 'succeeded', 'failed', 'cancelled', 'skipped', 'reused')),
                                                  -- reused = a source-level artifact already existed
    model            TEXT,                        -- agent stages: the model used; voice: the TTS model
    provider         TEXT,                        -- who ran it: claude-cli | ai-gateway | elevenlabs (later codex-cli, opencode-cli)
    billing          TEXT CHECK (billing IN ('billed', 'subscription')),
                                                  -- billed: real money (an API key, the gateway); subscription: the
                                                  --   API-equivalent value a CLI plan reports, not charged per use
    agent_session_id TEXT,                        -- agent stages: Claude session id, for resume
    error            TEXT,
    -- cost, so we can measure what a short costs
    input_tokens     INTEGER,
    output_tokens    INTEGER,
    cost_usd         REAL,                        -- as reported by the provider (the gateway: the higher of its charge and
                                                  --   the BYOK market cost)
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
    reference_id TEXT REFERENCES reference_videos (id) ON DELETE CASCADE,  -- reference-video analysis
    stage_run_id TEXT REFERENCES stage_runs (id) ON DELETE SET NULL,
    kind         TEXT NOT NULL,
                  -- source-level:  source-video | transcript | contact-sheet | ad-ranges | story-map
                  -- project-level: script | shot-plan | cut-plan | voiceover | voiceover-transcript
                  --                | narrated-plan | music-config | render | captions | metadata
                  --                | thumb-config | thumbnail | sound-cues
                  -- reference:     reference-video | reference-analysis
    version      INTEGER NOT NULL,                -- 1, 2, 3… per owner and kind; regenerating adds a version
    data         TEXT,                            -- JSON for structured artifacts, decoded with the kind's schema
    path         TEXT,                            -- file artifacts: relative to the owner's folder
    created_at   TEXT NOT NULL,
    -- exactly one owner
    CHECK ((source_id IS NOT NULL) + (project_id IS NOT NULL) + (reference_id IS NOT NULL) = 1),
    CHECK (data IS NOT NULL OR path IS NOT NULL)
  );
  -- "current" artifact of a kind = highest version
  CREATE UNIQUE INDEX artifacts_source_versions  ON artifacts (source_id, kind, version)  WHERE source_id IS NOT NULL;
  CREATE UNIQUE INDEX artifacts_project_versions ON artifacts (project_id, kind, version) WHERE project_id IS NOT NULL;
  CREATE UNIQUE INDEX artifacts_reference_versions ON artifacts (reference_id, kind, version) WHERE reference_id IS NOT NULL;

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

  -- What model evals (cli eval) spent, recorded in your library even though an eval runs in a scratch one, so

  -- Settings › Usage shows it, and Settings › Agents shows each model's pass rate and cost.

  CREATE TABLE eval_runs (

    id             TEXT PRIMARY KEY,

    eval_id        TEXT NOT NULL,                -- one cli eval: its report folder's name

    stage          TEXT NOT NULL,                -- ads | story | script | metadata

    provider       TEXT NOT NULL,                -- claude-cli | ai-gateway

    model          TEXT NOT NULL,                -- as asked for: claude-cli, openai/gpt-6-luna

    reported_model TEXT,                         -- what the provider says it ran

    run            INTEGER NOT NULL,

    status         TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'skipped')),

    first_try_pass INTEGER,                      -- 1 | 0 | null (skipped)

    fix_rounds     INTEGER NOT NULL DEFAULT 0,

    input_tokens   INTEGER,

    output_tokens  INTEGER,

    cost_usd       REAL NOT NULL DEFAULT 0,

    billing        TEXT CHECK (billing IN ('billed', 'subscription')),

    duration_ms    INTEGER,

    created_at     TEXT NOT NULL,

    UNIQUE (eval_id, stage, model, run)

  );

  CREATE INDEX eval_runs_by_created ON eval_runs (created_at);


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
