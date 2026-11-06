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
  persistence/         SQLite client, foreign keys on, migrations (never edit a shipped one; add a new one)
  sources/             long videos: row + ~/.viral/sources/<id>/, shared by every short from them;
                       source-stages.ts defines the video-level stages (source, transcribe, contact-sheet).
                       Links download at 1080p, else 720p, never higher; the size is kept in source-video
  artifacts/           versioned stage outputs, one folder per version: <owner>/<kind>/v<N>/
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
  metadata/            the metadata stage (Haiku): title, alternates, description, hashtags; publishes the mp4,
                       srt and <slug>.md into ~/.viral/renders/
  thumbnail/           the thumbnail stage, last in both pipelines (gated): a vision agent (thumbnails skill) picks
                       the layout, the hero moment and crop, the strongest reaction face, the colours and the words,
                       with `contact_sheet` and `preview_thumbnail`; crops are frame fractions turned into pixels.
                       render-thumbnail.py draws two layouts: `bold` (the default: a gradient, the hero and the face
                       cut out with outlines by cutout.py (rembg, models cached in ~/Library/Caches/Viral/models,
                       VIRAL_MODELS_DIR overrides), curiosity words, an arrow or emoji; a failed cut-out falls back
                       to a framed inset, VIRAL_CUTOUT=off forces that) and `classic` (the skill's thumbnail.py,
                       unchanged). Once approved (the stage's `approved` hook) the jpg is published as
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
                       first-run tools: the server fetches them in the background once the required tools are
                       ready (VIRAL_PREFETCH_MODELS=off skips), Settings › Tools shows the progress
                       (PrefetchBackgroundRemoval), and a bold thumbnail waits for them with a progress message
  projects/            shorts: row + ~/.viral/projects/<id>/, numbered per source (01-, 02-…)
  presets/             style profiles; one default, seeded on first start
  music-library/       tracks (uploaded, imported from a link, or bundled) with origin and rights, in ~/.viral/music/;
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
                       The voice is the project's (`project voice`) or the preset's; ListVoices / PreviewVoice
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
  agent-session/       runs every agent stage on the Claude CLI: isolated session, skills in the prompt, one
                       propose_* tool whose Effect Schema is also its input schema, read-only stage folders,
                       per-stage model, cost + session recording, resume; AgentSession.replay for tests.
                       run-checked.ts: the loop every agent stage uses (ask → server check → hand problems back).
                       A task can offer helper tools (`agentTool`) besides its propose_* tool
  settings/            app preferences as JSON under keys (e.g. stage.story.model)
  render/              the render stage (gated; a rejection goes back to the shots, or the sections for a
                       cut-down short, with your note, via the stage's `rejectTo`) + render engine + its Python
                       scripts (render-short.py is the skill's cut-down renderer: word-snapped sections, crop or
                       blurred fill, 3-word captions, hook title card, credit; render-narrated.py is the viral-shorts renderer,
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
                       sheet tiles on older sheets
                       shorts/: a short's editor, one fixed frame for every step (editor-frame.tsx: step bar, stage,
                       inspector, timeline), from GetShortWorkspace and the run followed live. Script and Voice
                       answer their gates (approve, ask with a note, edit; a script edit is checked first with
                       CheckScriptEdit so a bad one never fails the run); editor-values.ts lays the short out on
                       its timeline the way the renderer plays it. shots/: the Shots step (preview in the style's
                       framing, storyboard, a frame picker over ListFramesAround stills, framing/crop/speed); its
                       changes collect into one edit, checked with CheckShotsEdit before it answers the gate.
                       Edits to an approved short's shots aren't supported yet (only at the gate)
  api/                 the RPC client (AtomRpc over one WebSocket) and the atom registry
  lib/  config/        small shared helpers (media URLs, formatting); where the server is
apps/desktop/          the Electron shell: starts the server (node in dev; Electron's own Node packaged), opens the
                       UI (the dev server, or viral://app/ from Resources/web with a strict CSP), window buttons
                       over the sidebar, preload bridge (server URL, user name, inset, Show in Finder, the open
                       panel for a video file), electron-updater.
                       vp pack bundles main/preload and the server (dist-server); electron-builder makes Viral.app
packages/contracts/    wire schemas + RpcGroups, one file per domain
packages/ui/           @viral/ui: Tailwind v4 tokens (theme.css: CarbonMe's values, lemon primary, dark and light,
                       28/32px controls) and primitives on Base UI + cva
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
bun run test:golden   # candy render vs the original short + transcription per provider (slow; needs fixtures:sync)
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
