# AGENTS.md

Viral helps content creators turn long videos into viral shorts. One headless Effect server owns the
pipeline (agent stages, media jobs, approvals, state); web, desktop (Electron) and mobile (Expo) are
thin clients over a typed Effect RPC WebSocket. The Claude CLI (via the Claude Agent SDK) is always
the default agent provider.

## Layout

Domain-driven and colocated: a domain folder owns its services, RPC handlers, prompts, scripts and
tests. There is no `features/` wrapper and no in-app `shared/` folder — domains import each other
directly.

```
apps/server/src/
  main.ts              wires domain layers + the RPC server; listens on 127.0.0.1 (VIRAL_PORT, default 3410) and
                       stops when the app that started it (VIRAL_PARENT_PID) is gone
  media/               GET /media/<path>: read-only files from the Viral home for the app (never viral.db,
                       symlinks checked, byte ranges for seeking) + GET /healthz
  home/                ~/.viral paths ($VIRAL_HOME overrides; tests use a temp dir)
  persistence/         SQLite client, foreign keys on, migrations (never edit a shipped one; add a new one). Migrations
                       run with foreign keys off, so one can rebuild a table the SQLite way; it checks the rows and
                       keys itself before it commits (0002-multi-video.ts upgrades libraries in place)
  sources/             long videos: row + ~/.viral/sources/<id>/, shared by every short that uses them;
                       source-stages.ts defines the video-level stages (source, transcribe, contact-sheet).
                       Links download at 1080p, else 720p, never higher; the size is kept in source-video. A video a
                       short or video set uses can't be deleted (SourceInUse, "used by N shorts")
  artifacts/           versioned stage outputs, one folder per version: <owner>/<kind>/v<N>/ (owners: a source, a
                       video set (~/.viral/sets/<id>/), a project, a reference)
  transcribe/          word-timed transcripts: Grok STT (xAI key) or local mlx-whisper on Apple Silicon
                       (transcripts.ts reads a source's transcript for planning stages; quote-match.ts snaps
                       an agent's quoted line to the transcript's exact word timings)
  contact-sheet/       timestamped frame grids for picking b-roll by eye
  ads/                 the ads stage (Haiku): sponsor reads, ads, intros and end screens to keep out of shorts
  story/               the story stage: story beats with snapped quotes + 3 proposals (one per approach), each
                       of which `Projects.fromProposal` turns into a short
  assemble/            the assemble stage: shot plan + preset (+ music with a known drop) → the renderer's
                       narrated plan, or a cut-down short's sections + preset → the cut-down renderer's plan;
                       deterministic, so a short re-renders in another style without agent work
  music-bed/           a short's own music bed: the library holds raw songs only, never changed. Assemble fits the
                       short's song to it (render/fit-music.py: the groove looped in whole bars so the song's drop
                       lands on the drop word) and records a `music-bed` artifact (the wav + which parts of the song
                       play where); the narrated plan's `music_bed` points the renderer at it, so it doesn't fit again.
                       GetMusicBed reads it; RefitMusic changes the song (or removes it) and/or the drop word
                       (setting project.<id>.music.dropWord) and re-runs the short from assemble. A short can have
                       its own arrangement (project.<id>.music.arrangement; none = automatic): ordered blocks of the
                       song's bars (bar 0 the earliest whole bar before the drop), each looped N times, played after
                       the block before or pinned to start on the drop word or any voiceover word; music_bed.py's
                       `arrange` lays them out (lead-in ends on the first pin, gaps filled by looping in whole bars,
                       equal-power crossfades where unrelated parts meet, the last block loops to the end). The
                       automatic bed stays the original recipe, byte for byte, and describes itself as blocks.
                       music-arrangement.ts checks one in plain words (MusicArrangementInvalid); ArrangeMusic sets or
                       resets it and re-runs from assemble; PreviewMusicArrangement fits a throwaway bed in
                       projects/<id>/music-preview/ to listen to first. A new song resets the arrangement, a new drop
                       word keeps it (a "drop" block follows the word); one that no longer fits falls back to
                       automatic with a note. Cut-down shorts have no bed
  metadata/            the metadata stage (Haiku): title, alternates, description, hashtags; publishes the mp4,
                       srt and <slug>.md into ~/.viral/renders/
  thumbnail/           the thumbnail stage, last in both pipelines (gated): a vision agent (thumbnails skill) picks
                       the layout, the hero moment and crop, the strongest reaction face, the colours and the words,
                       with `contact_sheet` and `preview_thumbnail`; crops are frame fractions turned into pixels.
                       render-thumbnail.py draws two layouts: `bold` (the default: a gradient, the hero and the face
                       cut out with outlines, curiosity words, an arrow or emoji) and `classic` (the skill's
                       thumbnail.py, unchanged). Cut-outs, per layer: macOS's own subject cut-out first
                       (cutout-apple.py, Vision, macOS 14+, no download; VIRAL_CUTOUT_APPLE=on|off overrides), then
                       rembg (cutout.py) if its models are on disk (~/Library/Caches/Viral/models, VIRAL_MODELS_DIR
                       overrides); otherwise the layer reports "fallback: needs rembg models" and the stage fetches
                       them with progress and draws again (thumbnail-draw.ts). Anything else falls back to a framed
                       inset; VIRAL_CUTOUT=off forces that. Once approved (the stage's `approved` hook) the jpg is published as
                       ~/.viral/renders/<slug>.jpg
  script-runner/       runs the domains' uv Python scripts (JSON-line stdout protocol, stderr drained)
  secrets/             API keys: env var (.env) first, then the macOS Keychain (service "viral")
  tools/               ffmpeg, ffprobe, uv, yt-dlp: Viral's tools folder first (~/Library/Application Support/
                       Viral/tools; VIRAL_TOOLS_DIR overrides), then the PATH. Not bundled in the app: missing ones
                       are downloaded on first run from pinned URLs, checksum-verified (ffmpeg: hash recorded on the
                       first download), and the folder is put first on the server's PATH. yt-dlp is installed
                       through uv (`uv tool install`, uv's tool/bin/Python folders inside Viral's) because the
                       standalone macOS build takes 25–40 s to start; it upgrades via uv every few days.
                       ListTools / InstallTools. The background-removal models (rembg's isnet-general-use and
                       u2net_human_seg, ~355 MB, pinned by SHA-256, in ~/Library/Caches/Viral/models) are not
                       first-run tools. Where Apple's cut-out works (macOS 14+) they're only a fallback: never
                       prefetched, fetched when a thumbnail needs them or from Settings › Tools ("Download fallback
                       models"). Elsewhere the server fetches them in the background once the required tools are
                       ready (VIRAL_PREFETCH_MODELS=off skips), with progress in Settings › Tools
                       (PrefetchBackgroundRemoval)
  projects/            shorts: row + ~/.viral/projects/<id>/, numbered across the library (07-…; older shorts keep
                       their per-video numbers). A short draws from 1–10 videos (project_sources, V1 first;
                       sourcesOf(project)); several need a brief. A clip's optional `source` is its video's index
                       (absent = V1, so single-video plans are written as before). source-context.ts is what the
                       checks see per video (words, length, excluded ranges); ProjectSources loads a short's videos.
                       Agents, the workspace and the renderers use V1 only until multi-video lands (assemble stops a
                       plan with a clip from another video). A short's optional
                       brief (what it should achieve; CreateProject/CreateProjectFromProposal, SetProjectBrief) goes
                       first in the script, shots, sections, thumbnail and metadata prompts (creator-brief.ts)
  presets/             style profiles; one default, seeded on first start. Edits (UpdatePreset) and renames
                       (RenamePreset) go through preset-rules.ts first; a bad one is PresetInvalid with plain problems
  music-library/       tracks (uploaded, imported from a link, or bundled) with origin and rights, in ~/.viral/music/;
                       each is a full song or an already edited clip (kind; SetMusicTrackKind). AddMusicFolder adds
                       every audio file in a folder and lists the ones it skipped;
                       analyse-track.py (librosa) measures tempo (beats fitted to a line), the drop (where the bass
                       below 150 Hz jumps, snapped to a beat; null when unclear) and LUFS, in the background on
                       add and via AnalyseMusicTrack. A beat set by hand (beat_source manual) is never overwritten
  sound-library/       sound-effect samples by category, with variants, in ~/.viral/sounds/
  references/          viral videos kept to learn from; their analyses are reference-owned artifacts
  runs/                runs a source or a short through its stages: reuse of approved work, gates (approve,
                       reject with a note, edit), cancel, resume after restart, events + live progress
  script/              the script stage: prompt (built on the chosen proposal's angle), per-approach rules, and
                       the script gate
  voice/               ElevenLabs (voices, text to speech) + the voice stage: one take of the narration, leading
                       silence trimmed, atempo to the preset's words/sec, local-Whisper word timings, voice gate.
                       The voice is the project's (`project voice`) or the preset's; ListVoices / PreviewVoice.
                       Library › Voices: Explore ElevenLabs' shared library (ExploreVoices; Narration first), add one
                       (AddLibraryVoice; a full plan's voice slots fail as code "limit"), RemoveVoice (never premade).
                       Tests run against a fake HTTP server via ELEVENLABS_API_URL — never add voices to a real account
  sections/            the sections stage (cut-down shorts): an agent picks the creator's best stretches of
                       speech by story beat, hook first (`contact_sheet`, `preview_sections`); the server snaps
                       them to the nearest whole words, checks length/order/overlaps/excluded ranges, and draws a
                       storyboard with a frame per section. A cut-down run is sections → assemble → render → metadata
  shots/               the shots stage: a vision agent anchors b-roll to voiceover words from the contact sheets,
                       asking for 1-per-second detail sheets (`contact_sheet` tool); the server places the
                       script's real lines as inserts/outro, checks the plan, and draws storyboard.png for the gate.
                       Frames are always kept one image per file (contact sheets: frames/frame_NNNNN.jpg;
                       shot plans: frames/shot-NN.jpg…) and stitched from those, so clients can offer any frame
  agent-skills/        the app's skill pack (skills/<name>/SKILL.md) + SkillPack, which loads it
  agent-session/       runs every agent stage: isolated session, skills in the prompt, one
                       propose_* tool whose Effect Schema is also its input schema, read-only stage folders,
                       per-stage model, cost + session recording, resume; AgentSession.replay for tests.
                       run-checked.ts: the loop every agent stage uses (ask → server check → hand problems back).
                       A task can offer helper tools (`agentTool`) besides its propose_* tool.
                       The providers live in packages/provider-* (below); AgentSession builds the system prompt
                       from the skill pack and routes each task. The route is task.route (evals), else
                       resolveAgentRoute (contracts/settings.ts, shared with the web): the step's own choice, then
                       the default (agents.default); shots, sections and thumbnail run only on VISION_PROVIDERS
                       (the Claude CLI for now) and fall back to it. Every cost is stamped with its provider and
                       billing (billed | subscription: the Claude CLI is a plan's value unless ANTHROPIC_API_KEY is
                       set; Codex is always subscription, tokens only) on stage_runs
  eval/                the eval harness (`bun run cli eval`): runs ads, story, script and metadata on a fixed fixture
                       (~/.viral/fixtures/candy/eval, made by `eval export`) with no gates, through the production
                       tasks and checks, on any models, in a scratch library; records cost, time, first-try pass and
                       fix rounds, stops priced runs at the budget and plan runs at --plan-runs per CLI, and writes
                       report.json/report.md + a side-by-side eval.html
                       (--include puts earlier evals' runs on the same page). Each run's result and spend is also
                       recorded in your library's eval_runs (eval-records.ts; `eval record <dir>` for an old one),
                       for Settings › Usage (Evals) and Settings › Agents (how each model did)
  settings/            app preferences as JSON under keys; app-settings.ts is the typed view: agents.default and
                       stage.<name>.provider/.model (Settings › Agents), transcription.provider
  usage/               Settings › Usage: spend by day, provider (billed vs plan), model, short, step, and evals
  render/              the render stage (gated; a rejection goes back to the shots, or the sections for a
                       cut-down short, with your note, via the stage's `rejectTo`) + render engine + its Python
                       scripts (render-short.py is the skill's cut-down renderer: word-snapped sections, crop or
                       blurred fill, 3-word captions, hook title card, credit; render-narrated.py is the viral-shorts renderer;
                       music_bed.py is its music-bed math, shared with fit-music.py,
                       ported with JSON-line reporting, plus approach/style features: inserts, full-bleed,
                       headline, chunk/quote captions, labels, credit). Two goldens: the original candy short
                       (must stay identical) and a features render (VIRAL_UPDATE_GOLDEN=1 refreshes it on purpose)
apps/cli/              dev client over RPC, one <domain>-command.ts per command group
apps/web/src/          the UI (vite-plus, React 19, TanStack Router, Effect atoms over the RPC client), feature-based
                       like CarbonMe's dashboard:
  routes/              thin file routes; each renders one module's page
  modules/<feature>/   a feature's page, parts, data atoms, pure values and tests (layout, system, home, waiting,
                       videos, shorts, settings, …). layout/ is the fixed frame: sidebar, title bar, page column.
                       videos/: New source and a video's page (GetSourceOverview; the source run followed live
                       by folding SubscribeRun in run-progress.ts); frames come from contact-sheet stills, or from
                       sheet tiles on older sheets. "Make this short" asks for the optional brief first
                       (make-short-dialog.tsx)
                       shorts/: a short's editor, one fixed frame for every step (editor-frame.tsx: step bar, stage,
                       inspector, timeline), from GetShortWorkspace and the run followed live. The title bar's Brief
                       button edits the brief (just save, or save and re-run from Script/Sections). Script and Voice
                       answer their gates (approve, ask with a note, edit; a script edit is checked first with
                       CheckScriptEdit so a bad one never fails the run); editor-values.ts lays the short out on
                       its timeline the way the renderer plays it. shots/: the Shots step (preview in the style's
                       framing, storyboard, a frame picker over ListFramesAround stills, framing/crop/speed); its
                       changes collect into one edit, checked with CheckShotsEdit before it answers the gate.
                       Edits to an approved short's shots aren't supported yet (only at the gate).
                       music/: the Music step (narrated shorts only; it opens once assemble has run): the fitted bed
                       (GetMusicBed) played with the voiceover, which pauses where real lines play, the bed's
                       parts and the drop word marked; the inspector's song (tempo, rights, the part of the song
                       that plays on its waveform), Change song over the library plus No music, and the drop word
                       picked from the narration. Applying calls RefitMusic (stopping a run that's going) and
                       follows the re-run from assemble; no song is a calm "Voice only", never a warning.
                       Detailed mode adds an Arrange tab (music-arrange.tsx, use-arrange-draft.ts): the bed's
                       arrangement blocks as parts ("Bars 9–12 ×3", "Drop") on the Music lane (loops as ticks,
                       pinned words and the drop marked on the narration; click to select), the selected part's
                       bars dragged on the song's waveform (snapping to bars), plays, start (after / drop word /
                       a word picked on the stage's narration), ⋯ Split, Duplicate, Move, Delete; Add a part;
                       Reset to automatic. Edits are a draft (undo, Discard) checked client-side
                       (music-values.ts mirrors the bed's layout) and on the server: Preview plays a
                       PreviewMusicArrangement bed on the stage, Apply calls ArrangeMusic and follows the re-run

                       render/: the Render step (the mp4 in a 9:16 player the timeline's playhead follows, the
                       check sheet, "Send back" to Shots/Sections or Style via Reject.to). publish/: the post
                       text (choose a title, copy it all), the files, and a rights reminder. thumbnail/: the
                       thumbnail in a phone frame, its moments, and word edits checked with CheckThumbnailEdit.
                       The Sections step of a cut-down short has no view yet
                       library/: Styles (cards with a CSS 9:16 preview of each style; the editor at ?edit=<id>, whose
                       Voice group holds the style's voice and pace), Music (songs with a decoded waveform and drop,
                       kind and rights, add songs or a folder; "Used by" opens each short's editor) and Voices (free
                       samples, a paid "Try a line", the default style's voice tagged Default, "Set as default"
                       (SetDefaultVoice) and "Use for style" for the other styles). There is no Settings › Voice: the
                       default voice lives in Library › Voices, pace in the style editor. Loading is a skeleton of the page (library-loading.tsx), never a spinner
  api/                 the RPC client (AtomRpc over one WebSocket) and the atom registry
  lib/  config/        small shared helpers (media URLs, formatting); where the server is
apps/desktop/          the Electron shell: starts the server (node in dev; Electron's own Node packaged), opens the
                       UI (the dev server, or viral://app/ from Resources/web with a strict CSP), window buttons
                       over the sidebar, preload bridge (server URL, user name, inset, Show in Finder, the open
                       panel for a video or audio file, several files, or a folder), electron-updater.
                       vp pack bundles main/preload and the server (dist-server); electron-builder makes Viral.app
packages/contracts/    wire schemas + RpcGroups, one file per domain
packages/provider-core/ AgentTask/AgentRun/AgentError and toolEndpoint: the per-run MCP server (127.0.0.1, random
                       bearer token) serving a task's output and helper tools to Codex and OpenCode
packages/provider-claude-cli/ the Claude CLI via the Agent SDK (in-process tools, stop after the output tool)
packages/provider-ai-gateway/ AI SDK + Vercel AI Gateway (ai/@ai-sdk/gateway pinned; history in
                       ~/.viral/agent-sessions/ for resume; BYOK market cost; Anthropic cache markers)
packages/provider-codex/ our own `codex app-server` JSON-RPC client: one app-server per run in a scratch folder,
                       read-only sandbox, approvals never, shell/apps/plugins/skills off, the user's MCP servers
                       switched off by name; model + effort from the account's catalog; thread/resume; turn
                       interrupted once the output tool accepts. codexStatus for Settings. Tests use a fake app-server
packages/provider-opencode/ OpenCode 2 only: `opencode serve` per run (free port, password) configured by
                       OPENCODE_CONFIG_CONTENT (Viral agent; permission rules deny everything but viral_* tools); our
                       own client for its /api (no v2 SDK: sessions, prompt, SSE events, interrupt once the step that
                       sent the output ends), USD cost from the session's totals; refuses OpenCode < 2.2.6 with how to
                       update. Status asks `--standalone` (not the background service): any stored credential (incl.
                       the OpenCode Console, whose opencode/* models count) is signed in. Tests use a fake
packages/provider-testing/ replayRun, the replay provider behind AgentSession.replay, and the live checks' task (*.live.ts)
packages/ui/           @viral/ui: Tailwind v4 tokens (theme.css: CarbonMe's values, lemon primary, dark and light,
                       28/32px controls) and primitives on Base UI + cva (incl. Dialog, Textarea)
repos/                 gitignored reference source checkouts — read-only
scripts/               repo tooling (sync-repos.ts)
```

- Agent stages: a small TypeScript prompt in the stage's domain (`script/script-prompt.ts`) holds the stage's
  job and tool contract; the domain knowledge lives in the app's skill pack, `apps/server/src/agent-skills/`
  (a Claude Code plugin layout: `skills/<name>/SKILL.md`). `SkillPack` loads it at startup and appends a
  stage's skills to its system prompt. Skills are injected, not left to the Skill tool: the SDK's skill
  "preload" doesn't put content in a main-thread session, and a model that skips the lookup ignores the rules.
- Python scripts are standalone uv scripts (PEP 723 inline deps) next to the code that runs them. They
  write one JSON object per stdout line and report failure as `{"type":"error","code","message"}`;
  run them through `ScriptRunner`.
- Tests sit next to the file they cover (`script-prompt.test.ts`).
- A package exists only when it stands alone and is named for its purpose (`contracts`). Never add a
  generic `shared`/`utils`/`common` package or folder.

The database schema is designed up front in `docs/plans/database-schema.md` (local, gitignored) and
the migration matches it statement for statement. Change the design first, then the migration.

## Reference repos

`repos/` is gitignored and holds read-only source checkouts for agents to read. Run
`bun run repos:sync` to clone them (refs are pinned in `scripts/sync-repos.ts` and must match the
dependency versions in package.json). `repos/effect` is Effect v4 — start with
`repos/effect/LLMS.md` and `repos/effect/ai-docs/`.

- Use the reference repos as read-only material when working with related libraries. Prefer examples
  and patterns from their source over generated guesses or web search results. Effect v4 APIs differ
  a lot from v3 — check `repos/effect/packages/effect/src` first.
- Do not edit files under `repos/` and do not import from `repos/`.

ElevenLabs' agent skills (`sound-effects`, `music`, `text-to-speech`, `speech-to-text`, `voice-isolator`)
are installed for coding agents in `.agents/skills/` (symlinked into `.claude/skills/`, pinned in
`skills-lock.json`). Read the relevant one before calling an ElevenLabs API. They are coding-time help only:
the app's own agents load the app's skill pack, never these. Restore with `npx skills experimental_install`.

T3 Code (whose architecture we follow) is not included; if a local clone exists at
`~/Apps/Opensource/t3code`, read it there for reference.

## Commands

```bash
bun install           # also patches TypeScript with @effect/tsgo
cp .env.example .env  # API keys (gitignored); or store them in the Keychain:
                      #   security add-generic-password -s viral -a xai -w
bun run repos:sync    # clone reference source into repos/ (gitignored)
bun run typecheck     # effect-tsgo tsc per project: node (server, cli, contracts), ui, web, desktop
bun run dev           # the web dev server (:5733) + the desktop app, which starts the server; Ctrl-C stops all
                      #   (VIRAL_HOME=~/.viral/work/live-check bun run dev to open another library)
bun run dev:server    # node --watch apps/server/src/main.ts  (port 3410), for the CLI or the browser
bun run dev:web       # the UI alone at http://127.0.0.1:5733 (against a running server)
bun run cli tools install # download the missing tools (also happens on the app's first run)
bun run package:desktop # build the UI and Viral.app (apps/desktop/release/mac-arm64, unsigned)
bun run cli           # dev client; prints every command
bun run test          # node --test over apps and packages
bun run cli eval all --models claude-cli,codex,gateway:openai/gpt-6-luna --runs 2 --budget 3 --plan-runs 8
                      # agent-stage eval vs the CLI baseline → ~/.viral/evals/<date>-<stages>/eval.html
                      # (spend recorded in your library; --include <earlier eval dirs> combines the pages)
bun run test:golden   # candy render vs the original short + transcription per provider (slow; needs fixtures:sync)
bun run test:live     # each agent provider on its real CLI (Claude, Codex, OpenCode; a cent or so); skips any not set up
bun run fixtures:sync # copy the candy project (plans, media, golden outputs) into ~/.viral/fixtures (not in git)
```

A short from start to finish with the dev client (the server running):

```bash
bun run cli source add --file ~/videos/candy.mp4 --rights owned
bun run cli source run <source-id>                 # transcribe → contact sheets → ads → story; prints 3 proposals
bun run cli project from-proposal <source-id> <n>
bun run cli project style <project-id> <preset-id|default>   # see `preset list`
bun run cli music add <file> --rights owned && bun run cli music beat <track-id> <bpm> <drop-s>
bun run cli project music <project-id> <track-id|none>       # none = voice only
bun run cli project music-arrange <project-id> <file.json|auto> # the bed's arrangement (blocks of bars, loops, pins)
bun run cli project voice <project-id> <voice-id|preset>     # see `voices`
bun run cli project run <project-id> [--from <stage>]        # stops at each gate
bun run cli approve <request-id> | reject <request-id> "note" | edit <request-id> <file.json>
```

Finished shorts (mp4, srt, post notes) land in `~/.viral/renders/`.

Runtime is Node 24, which runs `.ts` directly via type stripping — use only erasable TS syntax (no
enums, namespaces or parameter properties). bun is the package manager.

## Conventions

- File names are kebab-case (`script-agent.ts`). Importable Python modules are snake_case.
- Effect v4 on the server: services as `Context.Service` with a static `layer`, keys
  as the `deterministicKeys` diagnostic expects, processes via `effect/process`, RPC via `effect/rpc`. Wrap SDK
  promises once at the seam; no raw Promises in server logic.
- Anything crossing a boundary (RPC, child-process JSON, agent tool input) is an Effect `Schema`.
  Schemas for files the Python scripts read (`narrated-plan.ts`, `thumb-config.ts`, `transcript.ts`)
  keep the scripts' snake_case keys, and their tests decode the candy fixtures with
  `onExcessProperty: "error"` so a key the schema doesn't model fails loudly.
- Commits follow Conventional Commits v1.0.0. No AI attribution lines in commits or PRs.
