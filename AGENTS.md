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
  main.ts              wires domain layers + the RPC server
  home/                ~/.viral paths ($VIRAL_HOME overrides; tests use a temp dir)
  persistence/         SQLite client, foreign keys on, migrations (never edit a shipped one; add a new one)
  sources/             long videos: row + ~/.viral/sources/<id>/, shared by every short from them;
                       source-stages.ts runs the video-level stages (source, transcribe, contact-sheet)
  artifacts/           versioned stage outputs, one folder per version: <owner>/<kind>/v<N>/
  transcribe/          word-timed transcripts: Grok STT (xAI key) or local mlx-whisper on Apple Silicon
  contact-sheet/       timestamped frame grids for picking b-roll by eye
  script-runner/       runs the domains' uv Python scripts (JSON-line stdout protocol, stderr drained)
  secrets/             API keys: env var (.env) first, then the macOS Keychain (service "viral")
  projects/            shorts: row + ~/.viral/projects/<id>/, numbered per source (01-, 02-…)
  presets/             style profiles; one default, seeded on first start
  music-library/       user-supplied tracks, copied into ~/.viral/music/
  jobs/                running jobs, approvals, cancel        (jobs.ts, jobs-rpc.ts)
  pipeline/            orders the stages, StartJob stream     (pipeline.ts, pipeline-rpc.ts)
  script/              script agent, its prompt and MCP tool  (script-agent.ts, script-prompt.ts)
  render/              render engine + its Python scripts (render-narrated.py is the viral-shorts renderer,
                       ported with JSON-line reporting; its golden test must keep matching the candy short)
apps/cli/              dev client over RPC, one <domain>-command.ts per command group
packages/contracts/    wire schemas + RpcGroups, one file per domain
repos/                 gitignored reference source checkouts — read-only
scripts/               repo tooling (sync-repos.ts)
```

- Prompts are TypeScript modules in the domain that uses them (`script/script-prompt.ts`).
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

T3 Code (whose architecture we follow) is not included; if a local clone exists at
`~/Apps/Opensource/t3code`, read it there for reference.

## Commands

```bash
bun install           # also patches TypeScript with @effect/tsgo
cp .env.example .env  # API keys (gitignored); or store them in the Keychain:
                      #   security add-generic-password -s viral -a xai -w
bun run repos:sync    # clone reference source into repos/ (gitignored)
bun run typecheck     # effect-tsgo tsc (TS7 + Effect diagnostics)
bun run dev:server    # node --watch apps/server/src/main.ts  (port 3410)
bun run cli run job-1 # dev client
bun run test          # node --test over apps and packages
bun run test:golden   # candy render vs the original short + transcription per provider (slow; needs fixtures:sync)
bun run fixtures:sync # copy the candy project (plans, media, golden outputs) into ~/.viral/fixtures (not in git)
```

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
