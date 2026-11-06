import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { ProjectId, SourceId } from "@viral/contracts"
import { Console, DateTime, Effect, FileSystem, Layer, Path, Schema } from "effect"
import { AgentSession } from "../agent-session/agent-session.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Projects } from "../projects/projects.ts"
import { Sources } from "../sources/sources.ts"
import { Transcripts } from "../transcribe/transcripts.ts"
import { EvalFixtureError, exportFixture, loadFixture } from "./eval-fixture.ts"
import { type EvalReport, reportHtml, reportMarkdown } from "./eval-report.ts"
import { type EvalModel, parseModel, runEval } from "./eval-runner.ts"
import { EvalStageName, evalStages } from "./eval-stages.ts"

// The eval's own process, started by `bun run cli eval`. VIRAL_HOME is the library it works in: a scratch
// one for `run` (agent sessions and settings land there, never in yours), the library to copy from for `export`.
//
//   eval-main.ts run --stages ads,story --models claude-cli,openai/gpt-6-luna --runs 2 --budget 5 --fixture <dir> --out <dir>
//   eval-main.ts export --source <id> --project <id> --out <dir> [--name candy]

const argv = process.argv.slice(2)
const option = (name: string) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}
const fail = (message: string) => new EvalFixtureError({ message })
const required = (name: string) => {
  const value = option(name)
  return value === undefined || value === "" ? Effect.fail(fail(`--${name} is required`)) : Effect.succeed(value)
}
const list = (value: string) => value.split(",").map((s) => s.trim()).filter((s) => s !== "")

const run = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const fixtureDir = yield* required("fixture")
  const outRoot = yield* required("out")
  const stageNames = yield* Schema.decodeUnknownEffect(Schema.Array(EvalStageName))(list(yield* required("stages"))).pipe(
    Effect.mapError(() => fail(`--stages takes some of: ${EvalStageName.literals.join(", ")}`))
  )
  const models: Array<EvalModel> = []
  for (const spec of list(yield* required("models"))) {
    const model = parseModel(spec)
    if (model === null) return yield* fail(`can't read the model "${spec}": use claude-cli, claude-cli:<model> or a gateway id like openai/gpt-6-luna`)
    models.push(model)
  }
  const runs = Number(option("runs") ?? "1")
  const budgetUsd = Number(option("budget") ?? "5")
  if (!Number.isInteger(runs) || runs < 1) return yield* fail("--runs takes a whole number from 1")
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) return yield* fail("--budget takes a dollar amount above 0")

  const fixture = yield* loadFixture(fixtureDir)
  const all = evalStages(fixture, fixtureDir, path)
  const stages = stageNames.map((name) => all[name])
  const now = yield* DateTime.now
  const stamp = DateTime.formatIso(now).slice(0, 16).replace(/[:T]/g, "-")
  const out = path.join(outRoot, `${stamp}-${stageNames.join("-")}`)
  yield* fs.makeDirectory(out, { recursive: true })

  yield* Console.log(`eval: ${stageNames.join(", ")} × ${models.map((m) => m.label).join(", ")}, ${runs} run(s), budget $${budgetUsd.toFixed(2)}`)
  const { results, spentUsd } = yield* runEval({
    stages,
    models,
    runs,
    budgetUsd,
    onResult: (r, spent) =>
      Console.log(
        `  run ${r.run} ${r.stage.padEnd(8)} ${r.model.padEnd(28)} ${r.status.padEnd(7)} $${r.costUsd.toFixed(4)} ${r.seconds.toFixed(1)}s` +
          (r.status === "skipped" ? "" : ` first try ${r.firstTryPass === true ? "yes" : "no"}, ${r.fixRounds} fix`) +
          (r.error === null ? "" : `  (${r.error.split("\n")[0]})`) +
          `  · spent $${spent.toFixed(4)}`
      )
  })
  const report: EvalReport = {
    createdAt: DateTime.formatIso(now),
    fixture: fixture.name,
    stages: stageNames,
    models: models.map((m) => m.label),
    runs,
    budgetUsd,
    spentUsd,
    results,
    reference: { ads: fixture.adRanges, story: fixture.story, script: fixture.short.script }
  }
  yield* fs.writeFileString(path.join(out, "report.json"), yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }))(report))
  yield* fs.writeFileString(path.join(out, "report.md"), reportMarkdown(report))
  yield* fs.writeFileString(path.join(out, "eval.html"), reportHtml(report))
  yield* Console.log(`\n${reportMarkdown(report)}\nside by side: ${path.join(out, "eval.html")}`)
}).pipe(Effect.provide(AgentSession.layer))

const exportCommand = Effect.gen(function*() {
  const fixture = yield* exportFixture({
    sourceId: SourceId.make(yield* required("source")),
    projectId: ProjectId.make(yield* required("project")),
    out: yield* required("out"),
    name: option("name") ?? "candy"
  })
  yield* Console.log(`exported "${fixture.source.title}" with the ${fixture.short.approach} short "${fixture.short.title}" to ${option("out")}`)
}).pipe(Effect.provide(Layer.mergeAll(Sources.layer, Projects.layer, Artifacts.layer, Transcripts.layer)))

const program = Effect.gen(function*() {
  if (argv[0] === "export") return yield* exportCommand
  if (argv[0] === "run") return yield* run
  return yield* fail("usage: eval-main.ts run|export …")
}).pipe(
  Effect.catchTag("EvalFixtureError", (e) => Console.error(e.message).pipe(Effect.andThen(Effect.sync(() => void (process.exitCode = 1))))),
  Effect.provide(NodeServices.layer)
)

NodeRuntime.runMain(program)
