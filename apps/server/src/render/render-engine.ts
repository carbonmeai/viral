import { NodeServices } from "@effect/platform-node"
import { CutRenderPlan, NarratedPlan, RankingRenderPlan, RenderChecks } from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect"
import { ViralHome } from "../home/viral-home.ts"
import { type ScriptError, ScriptRunner } from "../script-runner/script-runner.ts"

// `code` is the script's ("excluded-range", "anchor-mismatch", "ffmpeg", …), "spawn" / "exit" from the
// runner, or "plan" when the plan can't be written.
export class RenderError extends Schema.TaggedError<RenderError>()("RenderError", {
  code: Schema.String,
  message: Schema.String
}) {}

// Reports progress: a percentage (null when unknown) and an optional message for the person watching.
type Progress = (pct: number | null, message?: string) => Effect.Effect<void>

// How many clips of each video (by index, "0" = V1) played from its 1080p pieces and how many from the video's own
// file (source_pieces.py)
const FootageCounts = Schema.Record(Schema.String, Schema.Struct({ pieces: Schema.Int, scan: Schema.Int }))
export type FootageCounts = typeof FootageCounts.Type

export interface NarratedRender {
  readonly output: string
  readonly captions: string
  readonly durationS: number
  readonly shots: number
  readonly footage: FootageCounts
}

const NarratedStep = Schema.Literals(["shots", "outro", "overlays", "encode", "end-card"])
const NarratedLine = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ type: Schema.Literal("progress"), step: NarratedStep, done: Schema.Int, total: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("log"), message: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("done"),
    output: Schema.String,
    captions: Schema.String,
    duration_s: Schema.Finite,
    shots: Schema.Int,
    narration_s: Schema.Finite,
    outro_s: Schema.Finite,
    // the end card's length, part of duration_s (a style's comment question)
    end_card_s: Schema.optionalKey(Schema.Finite),
    footage: Schema.optionalKey(FootageCounts)
  })
]))

// Overall render % per step: cutting shots dominates; the final encode is one long ffmpeg pass.
const narratedPct = (step: typeof NarratedStep.Type, done: number, total: number) => {
  const fraction = total === 0 ? 1 : done / total
  switch (step) {
    case "shots":
      return 75 * fraction
    case "outro":
      return 75 + 5 * fraction
    case "overlays":
      return 82
    case "encode":
      return 85
    case "end-card":
      return 92 + 6 * fraction
  }
}

const PlanJson = Schema.fromJsonString(NarratedPlan)

export interface CutRender {
  readonly output: string
  readonly captions: string
  readonly durationS: number
  readonly sections: number
  readonly footage: FootageCounts
}

const CutStep = Schema.Literals(["sections", "overlays", "encode", "end-card"])
const CutLine = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ type: Schema.Literal("progress"), step: CutStep, done: Schema.Int, total: Schema.Int }),
  Schema.Struct({
    type: Schema.Literal("done"),
    output: Schema.String,
    captions: Schema.String,
    duration_s: Schema.Finite,
    sections: Schema.Int,
    end_card_s: Schema.optionalKey(Schema.Finite),
    footage: Schema.optionalKey(FootageCounts)
  })
]))
const CutPlanJson = Schema.fromJsonString(CutRenderPlan)

// Overall render % per step: cutting sections dominates, then one encode pass with the overlays.
const cutPct = (step: typeof CutStep.Type, done: number, total: number) => {
  const fraction = total === 0 ? 1 : done / total
  switch (step) {
    case "sections":
      return 70 * fraction
    case "overlays":
      return 72
    case "encode":
      return 75 + 20 * fraction
    case "end-card":
      return 95 + 4 * fraction
  }
}

export interface RankingRender {
  readonly output: string
  readonly captions: string
  readonly durationS: number
  readonly shots: number
  // where each entry plays in the short, in playing order
  readonly timeline: ReadonlyArray<{ readonly rank: number; readonly start: number; readonly end: number }>
  readonly checks: RenderChecks
  readonly footage: FootageCounts
}

const RankingStep = Schema.Literals(["shots", "encode", "checks"])
const RankingLine = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ type: Schema.Literal("progress"), step: RankingStep, done: Schema.Int, total: Schema.Int }),
  Schema.Struct({
    type: Schema.Literal("done"),
    output: Schema.String,
    captions: Schema.String,
    duration_s: Schema.Finite,
    shots: Schema.Int,
    timeline: Schema.Array(Schema.Struct({ rank: Schema.Int, start: Schema.Finite, end: Schema.Finite })),
    checks: RenderChecks,
    footage: Schema.optionalKey(FootageCounts)
  })
]))
const RankingPlanJson = Schema.fromJsonString(RankingRenderPlan)

// Overall render % per step: cutting the shots dominates, then the loudness pass, then the checks of the mp4.
const rankingPct = (step: typeof RankingStep.Type, done: number, total: number) => {
  const fraction = total === 0 ? 1 : done / total
  switch (step) {
    case "shots":
      return 80 * fraction
    case "encode":
      return 80 + 10 * fraction
    case "checks":
      return 90 + 5 * fraction
  }
}

// Runs the Python render scripts next to this file through the ScriptRunner.
export class RenderEngine extends Context.Service<RenderEngine, {
  // Writes the plan to `<workDir>/narrated.json` (its relative paths resolve against workDir) and
  // renders it to `out`, plus a sibling .srt.
  renderNarrated(plan: NarratedPlan, workDir: string, out: string, progress: Progress): Effect.Effect<NarratedRender, RenderError>
  // The same for a cut-down short: writes `<workDir>/cut.json` and renders it to `out` + .srt.
  renderCut(plan: CutRenderPlan, workDir: string, out: string, progress: Progress): Effect.Effect<CutRender, RenderError>
  // The same for a ranking: writes `<workDir>/ranking.json` and renders it to `out` + .srt, then checks the mp4.
  renderRanking(plan: RankingRenderPlan, workDir: string, out: string, progress: Progress): Effect.Effect<RankingRender, RenderError>
}>()("@viral/server/render/render-engine/RenderEngine") {
  static readonly layer = Layer.effect(
    RenderEngine,
    Effect.gen(function*() {
      const scripts = yield* ScriptRunner
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const home = yield* ViralHome
      const script = (name: string) => path.join(import.meta.dirname, name)
      const toRenderError = Effect.mapError((error: ScriptError) => new RenderError({ code: error.code, message: error.message }))

      const renderNarrated = Effect.fn("RenderEngine.renderNarrated")(
        function*(plan: NarratedPlan, workDir: string, out: string, progress: Progress) {
          const planFile = path.join(workDir, "narrated.json")
          yield* Schema.encodeEffect(PlanJson)(plan).pipe(
            Effect.flatMap((encoded) => fs.writeFileString(planFile, encoded)),
            Effect.mapError((error) => new RenderError({ code: "plan", message: error.message }))
          )
          return yield* scripts.run(
            [script("render-narrated.py"), planFile, "--out", out],
            Schema.decodeEffect(NarratedLine),
            (line): Effect.Effect<NarratedRender | undefined> => {
              switch (line.type) {
                case "progress":
                  return progress(narratedPct(line.step, line.done, line.total)).pipe(Effect.as(undefined))
                case "log":
                  return Effect.logInfo(line.message).pipe(Effect.as(undefined))
                case "done":
                  return Effect.succeed({
                    output: line.output,
                    captions: line.captions,
                    durationS: line.duration_s,
                    shots: line.shots,
                    footage: line.footage ?? {}
                  })
              }
            }
          ).pipe(toRenderError)
        }
      )

      const renderCut = Effect.fn("RenderEngine.renderCut")(
        function*(plan: CutRenderPlan, workDir: string, out: string, progress: Progress) {
          const planFile = path.join(workDir, "cut.json")
          yield* Schema.encodeEffect(CutPlanJson)(plan).pipe(
            Effect.flatMap((encoded) => fs.writeFileString(planFile, encoded)),
            Effect.mapError((error) => new RenderError({ code: "plan", message: error.message }))
          )
          return yield* scripts.run(
            [script("render-short.py"), planFile, "--out", out],
            Schema.decodeEffect(CutLine),
            (line): Effect.Effect<CutRender | undefined> =>
              line.type === "progress"
                ? progress(cutPct(line.step, line.done, line.total)).pipe(Effect.as(undefined))
                : Effect.succeed({
                  output: line.output,
                  captions: line.captions,
                  durationS: line.duration_s,
                  sections: line.sections,
                  footage: line.footage ?? {}
                })
          ).pipe(toRenderError)
        }
      )

      const renderRanking = Effect.fn("RenderEngine.renderRanking")(
        function*(plan: RankingRenderPlan, workDir: string, out: string, progress: Progress) {
          const planFile = path.join(workDir, "ranking.json")
          yield* Schema.encodeEffect(RankingPlanJson)(plan).pipe(
            Effect.flatMap((encoded) => fs.writeFileString(planFile, encoded)),
            Effect.mapError((error) => new RenderError({ code: "plan", message: error.message }))
          )
          return yield* scripts.run(
            [script("render-ranking.py"), planFile, "--out", out],
            Schema.decodeEffect(RankingLine),
            (line): Effect.Effect<RankingRender | undefined> =>
              line.type === "progress"
                ? progress(rankingPct(line.step, line.done, line.total)).pipe(Effect.as(undefined))
                : Effect.succeed({
                  output: line.output,
                  captions: line.captions,
                  durationS: line.duration_s,
                  shots: line.shots,
                  timeline: line.timeline,
                  checks: line.checks,
                  footage: line.footage ?? {}
                })
          ).pipe(toRenderError)
        }
      )

      return RenderEngine.of({ renderNarrated, renderCut, renderRanking })
    })
  ).pipe(Layer.provide([NodeServices.layer, ViralHome.layer, ScriptRunner.layer]))
}
