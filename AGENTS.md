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
  jobs/                running jobs, approvals, cancel        (jobs.ts, jobs-rpc.ts)
  pipeline/            orders the stages, StartJob stream     (pipeline.ts, pipeline-rpc.ts)
  script/              script agent, its prompt and MCP tool  (script-agent.ts, script-prompt.ts)
  render/              render engine + its Python script      (render-engine.ts, render-probe.py)
apps/cli/              dev client over RPC (stand-in until apps/web exists)
packages/contracts/    wire schemas + RpcGroups, one file per domain
repos/                 gitignored reference source checkouts — read-only
scripts/               repo tooling (sync-repos.ts)
```

- Prompts are TypeScript modules in the domain that uses them (`script/script-prompt.ts`).
- Python scripts are standalone uv scripts (PEP 723 inline deps) next to the code that runs them.
- Tests sit next to the file they cover (`script-prompt.test.ts`).
- A package exists only when it stands alone and is named for its purpose (`contracts`). Never add a
  generic `shared`/`utils`/`common` package or folder.

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
bun run repos:sync    # clone reference source into repos/ (gitignored)
bun run typecheck     # effect-tsgo tsc (TS7 + Effect diagnostics)
bun run dev:server    # node --watch apps/server/src/main.ts  (port 3410)
bun run cli run job-1 # dev client
bun run test          # node --test over apps and packages
```

Runtime is Node 24, which runs `.ts` directly via type stripping — use only erasable TS syntax (no
enums, namespaces or parameter properties). bun is the package manager.

## Conventions

- File names are kebab-case (`script-agent.ts`). Importable Python modules are snake_case.
- Effect v4 on the server: services as `Context.Service` with a static `layer`, keys
  as the `deterministicKeys` diagnostic expects, processes via `effect/process`, RPC via `effect/rpc`. Wrap SDK
  promises once at the seam; no raw Promises in server logic.
- Anything crossing a boundary (RPC, child-process JSON, agent tool input) is an Effect `Schema`.
- Commits follow Conventional Commits v1.0.0. No AI attribution lines in commits or PRs.
