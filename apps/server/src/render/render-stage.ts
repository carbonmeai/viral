import { NodeServices } from "@effect/platform-node"
import {
  type Artifact,
  CutRenderPlan,
  type GatePayload,
  NarratedPlan,
  type ProjectId,
  RankingRenderPlan,
  type RenderChecks,
  RenderedShort,
  type RenderFootage,
  Transcript
} from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ProjectSources } from "../projects/project-sources.ts"
import { Projects } from "../projects/projects.ts"
import { sourceLabel } from "../projects/source-context.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import type { Range } from "../sources/piece-ranges.ts"
import { type ShortFootage, SourcePieces } from "../sources/source-pieces.ts"
import { cutRanges, narratedRanges, rankingRanges } from "./footage-ranges.ts"
import { type FootageCounts, RenderEngine } from "./render-engine.ts"

const fail = (code: string, message: string) => new StageFailure({ stage: "render", code, message })

// columns of the check sheet: one row per ten seconds of the short
const CHECK_COLUMNS = 10

const projectOf = (ctx: StageContext): ProjectId => {
  if (ctx.owner._tag !== "Project") throw new Error("the render stage runs on a project")
  return ctx.owner.id
}

const TranscriptJson = Schema.fromJsonString(Transcript)

// The render gate's footage rows: for each video read from a 480p scan, how many clips played from its 1080p pieces
// and how many from the scan, and why any did. Empty when no video is a scan.
export const footageRows = (footage: ShortFootage, counts: FootageCounts): ReadonlyArray<RenderFootage> =>
  footage.videos.map((v) => {
    const used = counts[String(v.index)] ?? { pieces: 0, scan: 0 }
    const outside = used.scan > 0 && v.problem === null
      ? `${used.scan} ${used.scan === 1 ? "clip" : "clips"} reached past the fetched pieces`
      : null
    return {
      video: v.index,
      title: v.source.title,
      pieces: v.pieces.length,
      height: v.height,
      scanHeight: v.scanHeight,
      clips: used.pieces,
      scanClips: used.scan,
      problem: used.scan > 0 ? v.problem ?? outside : null
    }
  })

// One plain line for the run's progress when any clip played from a scan, so the drop in quality is never silent.
export const footageWarning = (rows: ReadonlyArray<RenderFootage>, several: boolean): string | null => {
  const low = rows.filter((r) => r.scanClips > 0)
  if (low.length === 0) return null
  return low.map((r) => {
    const name = several ? `${sourceLabel(r.video)}${r.title === null ? "" : ` (${r.title})`}` : r.title ?? "the video"
    const what = r.clips === 0 ? "plays" : `has ${r.scanClips} of ${r.clips + r.scanClips} clips`
    return `${name} ${what} from the ${r.scanHeight ?? 480}p reading copy: ${r.problem ?? "its pieces didn't cover them"}`
  }).join("; ") + ". Look before approving."
}

// Renders the assembled plan to an mp4 + srt and draws a check sheet (a frame per second) for the gate. A video read
// from a 480p scan (found by research) first gets the seconds the plan plays fetched in 1080p (SourcePieces); what
// couldn't be fetched plays from the scan, and the gate says so (`footage`). The render follows its plan, so rejecting it sends your note back to the stage that planned it (shots for a
// narrated short, sections for a cut-down one), and everything after runs again.
export class RenderStage extends Context.Service<RenderStage, {
  readonly narrated: StageDefinition
  readonly cut: StageDefinition
  readonly ranking: StageDefinition
}>()("@viral/server/render/render-stage/RenderStage") {
  static readonly layer = Layer.effect(
    RenderStage,
    Effect.gen(function*() {
      const artifacts = yield* Artifacts
      const engine = yield* RenderEngine
      const projects = yield* Projects
      const projectSources = yield* ProjectSources
      const sourcePieces = yield* SourcePieces
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      // Fetches the 1080p pieces of every scanned video the plan plays (nothing for full downloads or your files).
      const fetchFootage = Effect.fn("RenderStage.fetchFootage")(function*(ctx: StageContext, ranges: ReadonlyMap<number, ReadonlyArray<Range>>) {
        const project = yield* projects.get(projectOf(ctx)).pipe(Effect.mapError(() => fail("not-found", "no such project")))
        const videos = yield* projectSources.of(project).pipe(Effect.mapError(() => fail("not-found", "no such source")))
        const footage = yield* sourcePieces.forShort(
          videos.flatMap((v) => {
            const used = ranges.get(v.index) ?? []
            return used.length === 0 ? [] : [{ index: v.index, source: v.source, ranges: used }]
          }),
          ctx.progress
        )
        return { footage, several: videos.length > 1 }
      })

      // The gate's footage rows, and a warning in the run's progress when any clip played from a scan.
      const reportFootage = Effect.fn("RenderStage.reportFootage")(function*(
        ctx: StageContext,
        fetched: { readonly footage: ShortFootage; readonly several: boolean },
        counts: FootageCounts
      ) {
        const rows = footageRows(fetched.footage, counts)
        const warning = footageWarning(rows, fetched.several)
        if (warning !== null) yield* ctx.progress(null, warning)
        return rows
      })

      const checkSheet = (video: string, seconds: number, out: string) =>
        spawner.exitCode(ChildProcess.make("ffmpeg", [
          "-y", "-loglevel", "error", "-i", video,
          "-vf", `fps=1,scale=180:-2,tile=${CHECK_COLUMNS}x${Math.max(1, Math.ceil(seconds / CHECK_COLUMNS))}`,
          "-frames:v", "1", out
        ])).pipe(
          Effect.map((code) => code === ChildProcessSpawner.ExitCode(0) ? out : null),
          Effect.orElseSucceed(() => null)
        )

      // Records a finished render: its check sheet, its captions, and the render itself.
      const finish = Effect.fn("RenderStage.finish")(function*(
        ctx: StageContext,
        slot: { readonly dir: string; readonly relDir: string; readonly owner: Artifact["owner"]; readonly kind: Artifact["kind"]; readonly version: number },
        rendered: {
          readonly output: string
          readonly captions: string
          readonly durationS: number
          readonly parts: number
          readonly checks?: RenderChecks
          readonly footage: ReadonlyArray<RenderFootage>
        }
      ) {
        yield* ctx.progress(95, "drawing the check sheet")
        const sheet = yield* checkSheet(rendered.output, rendered.durationS, path.join(slot.dir, "check.png"))
        const result: RenderedShort = {
          video: rendered.output,
          captions: rendered.captions,
          durationS: rendered.durationS,
          shots: rendered.parts,
          checkSheet: sheet,
          ...(rendered.checks === undefined ? {} : { checks: rendered.checks }),
          ...(rendered.footage.length === 0 ? {} : { footage: rendered.footage })
        }
        const captions = yield* artifacts.allocate(ctx.owner, "captions")
        // the srt is written next to the mp4, in the render's folder
        yield* artifacts.record(captions, {
          data: null,
          path: path.join(slot.relDir, path.basename(rendered.captions)),
          stageRunId: ctx.stageRunId
        })
        yield* artifacts.record(slot, { data: result, path: path.join(slot.relDir, path.basename(rendered.output)), stageRunId: ctx.stageRunId })
      })

      const runNarrated = Effect.fn("RenderStage.narrated")(function*(ctx: StageContext) {
        const planArtifact = yield* artifacts.latest(ctx.owner, "narrated-plan")
        const plan = yield* Effect.fromOption(Option.flatMap(planArtifact, (a) => Schema.decodeUnknownOption(NarratedPlan)(a.data))).pipe(
          Effect.mapError(() => fail("not-ready", "the short hasn't been assembled"))
        )
        // the b-roll's stretches follow the voiceover's words
        const words = yield* fs.readFileString(plan.voiceover_transcript).pipe(
          Effect.flatMap(Schema.decodeEffect(TranscriptJson)),
          Effect.map((t) => t.segments.flatMap((s) => s.words)),
          Effect.orElseSucceed(() => [])
        )
        const fetched = yield* fetchFootage(ctx, narratedRanges(plan, words))
        const slot = yield* artifacts.allocate(ctx.owner, "render")
        const withPieces: NarratedPlan = fetched.footage.piecesBySource === undefined ? plan : { ...plan, pieces_by_source: fetched.footage.piecesBySource }
        const rendered = yield* engine.renderNarrated(withPieces, slot.dir, path.join(slot.dir, `${plan.slug}.mp4`), ctx.progress).pipe(
          Effect.mapError((e) => fail(e.code, e.message))
        )
        const footage = yield* reportFootage(ctx, fetched, rendered.footage)
        yield* finish(ctx, slot, { ...rendered, parts: rendered.shots, footage })
      })

      const runCut = Effect.fn("RenderStage.cut")(function*(ctx: StageContext) {
        const planArtifact = yield* artifacts.latest(ctx.owner, "cut-render-plan")
        const plan = yield* Effect.fromOption(Option.flatMap(planArtifact, (a) => Schema.decodeUnknownOption(CutRenderPlan)(a.data))).pipe(
          Effect.mapError(() => fail("not-ready", "the short hasn't been assembled"))
        )
        const fetched = yield* fetchFootage(ctx, cutRanges(plan))
        const slot = yield* artifacts.allocate(ctx.owner, "render")
        const withPieces: CutRenderPlan = fetched.footage.piecesBySource === undefined ? plan : { ...plan, pieces_by_source: fetched.footage.piecesBySource }
        const rendered = yield* engine.renderCut(withPieces, slot.dir, path.join(slot.dir, `${plan.slug}.mp4`), ctx.progress).pipe(
          Effect.mapError((e) => fail(e.code, e.message))
        )
        const footage = yield* reportFootage(ctx, fetched, rendered.footage)
        yield* finish(ctx, slot, { ...rendered, parts: rendered.sections, footage })
      })

      // A ranking's mp4 is checked as it's rendered: black stretches, every shot's first and last frame, loudness.
      const runRanking = Effect.fn("RenderStage.ranking")(function*(ctx: StageContext) {
        const planArtifact = yield* artifacts.latest(ctx.owner, "ranking-render-plan")
        const plan = yield* Effect.fromOption(Option.flatMap(planArtifact, (a) => Schema.decodeUnknownOption(RankingRenderPlan)(a.data))).pipe(
          Effect.mapError(() => fail("not-ready", "the short hasn't been assembled"))
        )
        const fetched = yield* fetchFootage(ctx, rankingRanges(plan))
        const slot = yield* artifacts.allocate(ctx.owner, "render")
        const withPieces: RankingRenderPlan = fetched.footage.piecesBySource === undefined ? plan : { ...plan, pieces_by_source: fetched.footage.piecesBySource }
        const rendered = yield* engine.renderRanking(withPieces, slot.dir, path.join(slot.dir, `${plan.slug}.mp4`), ctx.progress).pipe(
          Effect.mapError((e) => fail(e.code, e.message))
        )
        const footage = yield* reportFootage(ctx, fetched, rendered.footage)
        const { black, lufs } = rendered.checks
        if (black.length > 0) {
          yield* ctx.progress(null, `black frames at ${black.map(([s, e]) => `${s.toFixed(1)}–${e.toFixed(1)}s`).join(", ")}: look before approving`)
        }
        if (lufs !== null && Math.abs(lufs - (plan.lufs ?? -14)) > 1.5) {
          yield* ctx.progress(null, `loudness measured ${lufs.toFixed(1)} LUFS (aimed for ${(plan.lufs ?? -14).toFixed(0)})`)
        }
        yield* finish(ctx, slot, { ...rendered, parts: rendered.shots, footage })
      })

      const gatePayload = (artifact: Artifact): GatePayload =>
        Option.match(Schema.decodeUnknownOption(RenderedShort)(artifact.data), {
          onNone: () => ({ _tag: "ArtifactGate", artifact }),
          onSome: (render) => ({ _tag: "RenderGate", render })
        })
      const base = { name: "render", artifact: "render", gate: "Approve the render?", gatePayload } as const

      return RenderStage.of({
        narrated: { ...base, rejectTo: "shots", run: runNarrated },
        cut: { ...base, rejectTo: "sections", run: runCut },
        ranking: { ...base, rejectTo: "moments", run: runRanking }
      })
    })
  ).pipe(Layer.provide([Artifacts.layer, RenderEngine.layer, Projects.layer, ProjectSources.layer, SourcePieces.layer, NodeServices.layer]))
}
