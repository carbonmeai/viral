import { Config, Console, Effect, Path } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { option, positionals } from "./args.ts"

export const EVAL_USAGE = `  eval <stages|all> --models <ids> [--runs N] [--budget USD] [--fixture <dir>]
                              (ads, story, script, metadata on the fixture; models: claude-cli, claude-cli:<model>,
                               or AI Gateway ids like anthropic/claude-haiku-4.5; writes ~/.viral/evals/<date>-<stages>/)
  eval export --from <library> --source <id> --project <id> [--name candy]
                              (copies a processed source and its approved short into ~/.viral/fixtures/<name>/eval)`

// The eval runs in its own server process, not through the running server: its agent sessions and settings go to
// a scratch library (~/.viral/evals/.home), so your library is never touched and no server is needed.
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
  const models = option("--models")
  if (models === undefined) return yield* Console.error(EVAL_USAGE)
  return yield* spawn({ VIRAL_HOME: path.join(home, "evals", ".home") }, [
    "run",
    "--stages", sub === "all" ? "ads,story,script,metadata" : sub,
    "--models", models,
    "--runs", option("--runs") ?? "1",
    "--budget", option("--budget") ?? "5",
    "--fixture", option("--fixture") ?? path.join(home, "fixtures", "candy", "eval"),
    "--out", path.join(home, "evals")
  ])
})
