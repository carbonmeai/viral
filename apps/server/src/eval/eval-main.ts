import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { ProjectId, SourceId, SourceSetId } from "@viral/contracts"
import { Config, Console, DateTime, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { AgentSession } from "../agent-session/agent-session.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ProjectSources } from "../projects/project-sources.ts"
import { Projects } from "../projects/projects.ts"
import { Sources } from "../sources/sources.ts"
import { Transcripts } from "../transcribe/transcripts.ts"
import { VideoSets } from "../video-sets/video-sets.ts"
import { EvalFixtureError, exportFixture, loadFixture } from "./eval-fixture.ts"
import { exportSetFixture, loadSetFixture } from "./eval-set-fixture.ts"
import { databaseAt } from "../persistence/database.ts"
import { evalBilling, EvalRecords } from "./eval-records.ts"
import { combineReports, type EvalReport, reportHtml, reportMarkdown, StoredEvalReport } from "./eval-report.ts"
import { type EvalModel, parseModel, runEval } from "./eval-runner.ts"
import { type EvalStage, EvalStageName, evalStages, setStoryEvalStage } from "./eval-stages.ts"

// The eval's own process, started by `bun run cli eval`. VIRAL_HOME is the library it works in: a scratch
// one for `run` (agent sessions and settings land there, never in yours), the library to copy from for `export`.
//
//   eval-main.ts run --stages ads,story --models claude-cli,codex,gateway:openai/gpt-6-luna --runs 2 --budget 5
//                    [--plan-runs 8] --fixture <dir> --out <dir> [--record <library>] [--include <earlier report folders>]
//   eval-main.ts record --dir <report folder> --record <library>
//   eval-main.ts run --stages set-story --models … --fixture <set fixture dir> --out <dir> …   (set-story runs alone)
//   eval-main.ts export --source <id> --project <id> --out <dir> [--name candy]
//   eval-main.ts export-set --set <id> --out <dir> [--name candy-heidi] [--names "Candy,Heidi Klum"]
//
// --record writes every run's result and spend into that library's database (eval_runs), so Settings › Usage
// counts eval spend and Settings › Agents shows how each model did; `record` does it for an earlier report.

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

// Where eval results go: that library's database with --record, nowhere without it.
const recording = (library: string | undefined) =>
  library === undefined
    ? Layer.succeed(EvalRecords, EvalRecords.of({ record: Effect.fn("EvalRecords.record")(() => Effect.void), byModel: Effect.succeed([]) }))
    : EvalRecords.layer.pipe(Layer.provide(databaseAt(`${library}/viral.db`)))

// A CLI signed in to a plan reports the plan's value; with an API key it's real money.
const cliBilled = Config.option(Config.String("ANTHROPIC_API_KEY")).pipe(Effect.map(Option.isSome), Effect.orDie)

const readReport = Effect.fn("readReport")(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const json = yield* fs.readFileString(`${dir}/report.json`).pipe(Effect.mapError((e) => fail(`can't read ${dir}/report.json: ${e.message}`)))
  const stored = yield* Schema.decodeEffect(StoredEvalReport)(json).pipe(Effect.mapError((e) => fail(`${dir}/report.json: ${e.message}`)))
  const billed = yield* cliBilled
  const { videos, ...rest } = stored
  return {
    ...rest,
    ...(videos === undefined ? {} : { videos }),
    results: stored.results.map((r) => ({ ...r, billing: r.billing ?? evalBilling(r.provider, billed), costBasis: r.costBasis ?? null }))
  } satisfies EvalReport
})

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
    if (model === null) {
      return yield* fail(
        `can't read the model "${spec}": use claude-cli[:<model>], codex[:<model>], opencode:<provider/model>, anthropic:<id>, openai:<id>, ` +
          `google:<id>, openrouter:<vendor/model> or gateway:<vendor/model> (e.g. anthropic:claude-haiku-5-5, gateway:openai/gpt-6-luna)`
      )
    }
    models.push(model)
  }
  const runs = Number(option("runs") ?? "1")
  const budgetUsd = Number(option("budget") ?? "5")
  const planRuns = Number(option("plan-runs") ?? "8")
  if (!Number.isInteger(runs) || runs < 1) return yield* fail("--runs takes a whole number from 1")
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) return yield* fail("--budget takes a dollar amount above 0")
  if (!Number.isInteger(planRuns) || planRuns < 0) return yield* fail("--plan-runs takes a whole number from 0")

  // set-story runs on a set fixture (several videos); the other stages on one video's fixture
  const onSet = stageNames.includes("set-story")
  if (onSet && stageNames.length > 1) return yield* fail("set-story runs on its own (it takes a set fixture): run it separately")
  const loaded = onSet
    ? yield* Effect.map(loadSetFixture(fixtureDir), (fixture) => ({
      name: fixture.name,
      stages: [setStoryEvalStage(fixture, fixtureDir, path)] as ReadonlyArray<EvalStage>,
      reference: fixture.reference === null ? {} : { "set-story": fixture.reference },
      videos: fixture.videos.map((v) => ({ name: v.name }))
    }))
    : yield* Effect.map(loadFixture(fixtureDir), (fixture) => {
      const all = evalStages(fixture, fixtureDir, path)
      return {
        name: fixture.name,
        stages: stageNames.flatMap((name) => name === "set-story" ? [] : [all[name]]),
        reference: { ads: fixture.adRanges, story: fixture.story, script: fixture.short.script },
        videos: undefined
      }
    })
  const stages = loaded.stages
  const now = yield* DateTime.now
  const stamp = DateTime.formatIso(now).slice(0, 16).replace(/[:T]/g, "-")
  const out = path.join(outRoot, `${stamp}-${stageNames.join("-")}`)
  yield* fs.makeDirectory(out, { recursive: true })

  const evalId = path.basename(out)
  const createdAt = DateTime.formatIso(now)
  const billed = yield* cliBilled
  // every run is recorded in your library as it finishes, so a stopped eval still shows its spend
  const records = yield* EvalRecords
  const earlier = yield* Effect.forEach(list(option("include") ?? ""), readReport)

  yield* Console.log(
    `eval: ${stageNames.join(", ")} × ${models.map((m) => m.label).join(", ")}, ${runs} run(s), budget $${budgetUsd.toFixed(2)} for priced runs, ` +
      `${planRuns} runs per plan`
  )
  const { results, spentUsd } = yield* runEval({
    stages,
    models,
    runs,
    budgetUsd,
    billing: (provider) => evalBilling(provider, billed),
    maxSubscriptionRuns: planRuns,
    onResult: (r, spent) =>
      records.record(evalId, r, r.billing, createdAt).pipe(Effect.andThen(Console.log(
        `  run ${r.run} ${r.stage.padEnd(8)} ${r.model.padEnd(28)} ${r.status.padEnd(7)} ` +
          `${
            r.billing === "subscription"
              ? `${r.inputTokens + r.outputTokens} tok (plan)`
              : r.costBasis === "unknown"
              ? `${r.inputTokens + r.outputTokens} tok (price unknown)`
              : `$${r.costUsd.toFixed(4)}${r.costBasis === "estimate" ? " est." : ""}`
          } ${r.seconds.toFixed(1)}s` +
          (r.status === "skipped" ? "" : ` first try ${r.firstTryPass === true ? "yes" : "no"}, ${r.fixRounds} fix`) +
          (r.error === null ? "" : `  (${r.error.split("\n")[0]})`) +
          `  · spent $${spent.toFixed(4)}`
      )))
  })
  const thisRun: EvalReport = {
    createdAt,
    fixture: loaded.name,
    stages: stageNames,
    models: models.map((m) => m.label),
    runs,
    budgetUsd,
    spentUsd,
    results,
    reference: loaded.reference,
    ...(loaded.videos === undefined ? {} : { videos: loaded.videos })
  }
  // with --include, the page and table compare these runs together with the earlier ones
  const report = combineReports(thisRun, earlier)
  yield* fs.writeFileString(path.join(out, "report.json"), yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }))(report))
  yield* fs.writeFileString(path.join(out, "report.md"), reportMarkdown(report))
  yield* fs.writeFileString(path.join(out, "eval.html"), reportHtml(report))
  yield* Console.log(`\n${reportMarkdown(report)}\nside by side: ${path.join(out, "eval.html")}`)
}).pipe(Effect.provide(Layer.merge(AgentSession.layer, recording(option("record")))))

// Records an earlier report's runs in a library (for evals run before recording existed).
const recordCommand = Effect.gen(function*() {
  const dir = yield* required("dir")
  const library = yield* required("record")
  const report = yield* readReport(dir)
  const evalId = dir.split("/").filter((p) => p !== "").at(-1) ?? dir
  const records = yield* EvalRecords
  yield* Effect.forEach(report.results, (r) => records.record(evalId, r, r.billing, report.createdAt), { discard: true })
  yield* Console.log(`recorded ${report.results.length} runs of ${evalId} ($${report.spentUsd.toFixed(4)}) in ${library}`)
}).pipe(Effect.provide(recording(option("record"))))

const exportCommand = Effect.gen(function*() {
  const fixture = yield* exportFixture({
    sourceId: SourceId.make(yield* required("source")),
    projectId: ProjectId.make(yield* required("project")),
    out: yield* required("out"),
    name: option("name") ?? "candy"
  })
  yield* Console.log(`exported "${fixture.source.title}" with the ${fixture.short.approach} short "${fixture.short.title}" to ${option("out")}`)
}).pipe(Effect.provide(Layer.mergeAll(Sources.layer, Projects.layer, Artifacts.layer, Transcripts.layer)))

const exportSetCommand = Effect.gen(function*() {
  const fixture = yield* exportSetFixture({
    setId: SourceSetId.make(yield* required("set")),
    out: yield* required("out"),
    name: option("name") ?? "set",
    names: list(option("names") ?? "")
  })
  yield* Console.log(
    `exported the set "${fixture.name}" (${fixture.videos.map((v) => v.name).join(", ")})${fixture.reference === null ? " with no set story" : " and its set story"} to ${option("out")}`
  )
}).pipe(Effect.provide(Layer.mergeAll(VideoSets.layer, ProjectSources.layer, Artifacts.layer)))

const program = Effect.gen(function*() {
  if (argv[0] === "export") return yield* exportCommand
  if (argv[0] === "export-set") return yield* exportSetCommand
  if (argv[0] === "run") return yield* run
  if (argv[0] === "record") return yield* recordCommand
  return yield* fail("usage: eval-main.ts run|record|export|export-set …")
}).pipe(
  Effect.catchTag("EvalFixtureError", (e) => Console.error(e.message).pipe(Effect.andThen(Effect.sync(() => void (process.exitCode = 1))))),
  Effect.provide(NodeServices.layer)
)

NodeRuntime.runMain(program)
