import { Config, Console, Effect, Path } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { option, positionals } from "./args.ts"

export const EVAL_USAGE = `  eval <stages|all> --models <provider:model,…> [--runs N] [--budget USD] [--plan-runs N] [--fixture <dir>]
                              [--include <eval dirs>]
                              (ads, story, script, metadata on the fixture; models: claude-cli[:<model>],
                               codex[:<model>], opencode:<provider/model>, gateway:<id> such as
                               gateway:anthropic/claude-haiku-4.5; --budget caps priced runs (default $5),
                               --plan-runs caps runs on a plan per CLI (default 8); writes
                               ~/.viral/evals/<date>-<stages>/; --include puts earlier evals' runs on the same page)
  eval set-story --models <provider:model,…> [--runs N] [--budget USD] [--plan-runs N] [--fixture <dir>]
                              (the set-story stage alone, on a set fixture: default ~/.viral/fixtures/sets/candy-heidi)
  eval record <eval dir>      (records an earlier eval's runs and spend in your library)
  eval export --from <library> --source <id> --project <id> [--name candy]
                              (copies a processed source and its approved short into ~/.viral/fixtures/<name>/eval)
  eval export-set --from <library> --set <id> [--name candy-heidi] [--names "Candy,Heidi Klum"]
                              (copies a video set whose videos are read, and its set story, into
                               ~/.viral/fixtures/sets/<name>; --names sets the videos' short names, in set order)`

// The eval runs in its own server process, not through the running server: its agent sessions and settings go to
// a scratch library (~/.viral/evals/.home), so no server is needed. Only each run's result and spend are recorded
// in your library (eval_runs), for Settings › Usage and Settings › Agents.
export const evalCommand = Effect.fn("evalCommand")(function*() {
  const path = yield* Path.Path
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const userHome = yield* Config.String("HOME").pipe(Config.withDefault(""), Effect.orDie)
  const home = yield* Config.String("VIRAL_HOME").pipe(Config.withDefault(path.join(userHome, ".viral")), Effect.orDie)
  const root = path.join(import.meta.dirname, "../../..")
  const main = path.join(root, "apps/server/src/eval/eval-main.ts")
  const [, sub] = positionals

  const spawn = (env: Record<string, string>, args: ReadonlyArray<string>) =>
    spawner.exitCode(ChildProcess.make("node", [`--env-file-if-exists=${path.join(root, ".env")}`, main, ...args], {
      env,
      extendEnv: true,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit"
    })).pipe(Effect.tap((code) => Effect.sync(() => void (process.exitCode = code))))

  if (sub === undefined) return yield* Console.error(EVAL_USAGE)
  if (sub === "export") {
    const from = option("--from")
    const source = option("--source")
    const project = option("--project")
    if (from === undefined || source === undefined || project === undefined) return yield* Console.error(EVAL_USAGE)
    const name = option("--name") ?? "candy"
    return yield* spawn({ VIRAL_HOME: from }, [
      "export", "--source", source, "--project", project, "--name", name, "--out", path.join(home, "fixtures", name, "eval")
    ])
  }
  if (sub === "export-set") {
    const from = option("--from")
    const set = option("--set")
    if (from === undefined || set === undefined) return yield* Console.error(EVAL_USAGE)
    const name = option("--name") ?? "candy-heidi"
    const names = option("--names")
    return yield* spawn({ VIRAL_HOME: from }, [
      "export-set", "--set", set, "--name", name, "--out", path.join(home, "fixtures", "sets", name),
      ...(names === undefined ? [] : ["--names", names])
    ])
  }
  if (sub === "record") {
    const dir = positionals[2]
    if (dir === undefined) return yield* Console.error(EVAL_USAGE)
    return yield* spawn({ VIRAL_HOME: path.join(home, "evals", ".home") }, ["record", "--dir", path.resolve(dir), "--record", home])
  }
  const models = option("--models")
  const include = option("--include")
  if (models === undefined) return yield* Console.error(EVAL_USAGE)
  return yield* spawn({ VIRAL_HOME: path.join(home, "evals", ".home") }, [
    "run",
    "--stages", sub === "all" ? "ads,story,script,metadata" : sub,
    "--models", models,
    "--runs", option("--runs") ?? "1",
    "--budget", option("--budget") ?? "5",
    "--plan-runs", option("--plan-runs") ?? "8",
    "--fixture", path.resolve(option("--fixture") ?? (sub === "set-story" ? path.join(home, "fixtures", "sets", "candy-heidi") : path.join(home, "fixtures", "candy", "eval"))),
    "--out", path.join(home, "evals"),
    "--record", home,
    ...(include === undefined ? [] : ["--include", include.split(",").map((d) => path.resolve(d.trim())).join(",")])
  ])
})
