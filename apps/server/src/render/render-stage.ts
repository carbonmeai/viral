import { NodeServices } from "@effect/platform-node"
import {
  type Artifact,
  CutRenderPlan,
  type GatePayload,
  NarratedPlan,
  type ProjectId,
  RankingRenderPlan,
  type ReadBack,
  type RenderChecks,
  RenderedShort,
  type RenderFootage,
  Transcript
} from "@viral/contracts"
import { Clock, Config, Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Presets } from "../presets/presets.ts"
import { ProjectSources } from "../projects/project-sources.ts"
import { Projects } from "../projects/projects.ts"
import { sourceLabel } from "../projects/source-context.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import type { Range } from "../sources/piece-ranges.ts"
import { type ShortFootage, SourcePieces } from "../sources/source-pieces.ts"
import { Transcriber } from "../transcribe/transcriber.ts"
import { cutRanges, narratedRanges, rankingRanges } from "./footage-ranges.ts"
import {
  cutReadBackPlan,
  narratedReadBackPlan,
  parseSilences,
  rankingReadBackPlan,
  readBack,
  type ReadBackPlan,
  readBackSummary,
  SILENCE_SECONDS,
  type SourceText,
  sourceText
} from "./read-back.ts"
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

// The final-video check's switch (VIRAL_READ_BACK=off skips it: the test suite does) and its Whisper model (absent = the
// transcriber's own, large-v3-turbo, already on disk for the voice takes: ~7 s for a minute of short).
const READ_BACK_OFF = "turned off (VIRAL_READ_BACK=off)"

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
      const presets = yield* Presets
      const transcriber = yield* Transcriber
      const readBackOn = Option.getOrElse(yield* Config.option(Config.String("VIRAL_READ_BACK")).pipe(Effect.orDie), () => "on") !== "off"
      const readBackModel = Option.getOrUndefined(yield* Config.option(Config.String("VIRAL_READ_BACK_MODEL")).pipe(Effect.orDie))

      const wordsOf = (file: string | undefined) =>
        file === undefined
          ? Effect.succeed([])
          : fs.readFileString(file).pipe(
            Effect.flatMap(Schema.decodeEffect(TranscriptJson)),
            Effect.map((t) => t.segments.flatMap((s) => s.words)),
            Effect.orElseSucceed(() => [])
          )
      // each video's words and sentences, by its index in the plan (V1 = 0)
      const sourceTexts = (files: ReadonlyArray<string | undefined>) =>
        Effect.forEach(files, wordsOf).pipe(
          Effect.map((all) => new Map<number, SourceText>(all.map((words, i) => [i, sourceText(words)])))
        )
      // the style's "End with a comment question"
      const closingWanted = Effect.fn("RenderStage.closingWanted")(function*(ctx: StageContext) {
        const project = yield* projects.get(projectOf(ctx)).pipe(Effect.option)
        if (Option.isNone(project)) return false
        const preset = project.value.presetId === null
          ? yield* presets.getDefault.pipe(Effect.option)
          : yield* presets.get(project.value.presetId).pipe(Effect.catch(() => presets.getDefault), Effect.option)
        return Option.match(preset, { onNone: () => false, onSome: (p) => p.config.commentQuestion === true })
      })
      const silencesOf = (video: string, durationS: number) =>
        spawner.string(ChildProcess.make("ffmpeg", [
          "-nostats", "-loglevel", "error", "-i", video, "-vn",
          "-af", `silencedetect=n=-40dB:d=${SILENCE_SECONDS},ametadata=mode=print:file=-`, "-f", "null", "-"
        ])).pipe(Effect.map((out) => parseSilences(out, durationS)), Effect.orElseSucceed(() => []))

      // The final-video check: the render's audio transcribed (local Whisper preferred: free) into <render>/read-back/
      // and read back against the plan. It never fails the render: what stops it is said as the read-back's problem.
      const readBackOf = Effect.fn("RenderStage.readBack")(function*(
        ctx: StageContext,
        video: string,
        durationS: number,
        dir: string,
        plan: Effect.Effect<ReadBackPlan>
      ) {
        if (!readBackOn) return { provider: null, seconds: 0, transcript: null, checks: [], problem: READ_BACK_OFF } satisfies ReadBack
        const started = yield* Clock.currentTimeMillis
        yield* ctx.progress(96, "reading the finished short back")
        const outDir = path.join(dir, "read-back")
        const elapsed = Effect.map(Clock.currentTimeMillis, (now) => Math.round((now - started) / 100) / 10)
        const done = yield* fs.makeDirectory(outDir, { recursive: true }).pipe(
          Effect.mapError((e) => ({ message: e.message })),
          Effect.andThen(transcriber.transcribe(video, outDir, () => Effect.void, {
            prefer: "whisper-local",
            ...(readBackModel === undefined ? {} : { model: readBackModel })
          })),
          Effect.result
        )
        if (done._tag === "Failure") {
          return { provider: null, seconds: yield* elapsed, transcript: null, checks: [], problem: `couldn't transcribe the render: ${done.failure.message}` } satisfies ReadBack
        }
        const transcript = path.join(outDir, "transcript.json")
        const [heard, silences, expected] = yield* Effect.all([wordsOf(transcript), silencesOf(video, durationS), plan])
        const checks = readBack(expected, heard, silences)
        yield* ctx.progress(null, readBackSummary(checks))
        return { provider: done.success.provider, seconds: yield* elapsed, transcript, checks, problem: null } satisfies ReadBack
      })

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
        },
        expected: Effect.Effect<ReadBackPlan>
      ) {
        yield* ctx.progress(95, "drawing the check sheet")
        const sheet = yield* checkSheet(rendered.output, rendered.durationS, path.join(slot.dir, "check.png"))
        const heard = yield* readBackOf(ctx, rendered.output, rendered.durationS, slot.dir, expected)
        const result: RenderedShort = {
          video: rendered.output,
          captions: rendered.captions,
          durationS: rendered.durationS,
          shots: rendered.parts,
          checkSheet: sheet,
          ...(rendered.checks === undefined ? {} : { checks: rendered.checks }),
          ...(rendered.footage.length === 0 ? {} : { footage: rendered.footage }),
          readBack: heard
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
        const words = yield* wordsOf(plan.voiceover_transcript)
        const fetched = yield* fetchFootage(ctx, narratedRanges(plan, words))
        const slot = yield* artifacts.allocate(ctx.owner, "render")
        const withPieces: NarratedPlan = fetched.footage.piecesBySource === undefined ? plan : { ...plan, pieces_by_source: fetched.footage.piecesBySource }
        const rendered = yield* engine.renderNarrated(withPieces, slot.dir, path.join(slot.dir, `${plan.slug}.mp4`), ctx.progress).pipe(
          Effect.mapError((e) => fail(e.code, e.message))
        )
        const footage = yield* reportFootage(ctx, fetched, rendered.footage)
        const expected = Effect.gen(function*() {
          const project = yield* projects.get(projectOf(ctx)).pipe(Effect.option)
          const ranking = Option.isSome(project) && project.value.approach === "narrated-ranking"
          const sources = yield* sourceTexts([plan.source_transcript, ...(plan.sources ?? []).map((s) => s.transcript)])
          return narratedReadBackPlan(plan, words, sources, {
            closingWanted: yield* closingWanted(ctx),
            countdown: ranking ? project.value.sourceIds.length : null,
            durationS: rendered.durationS
          })
        })
        yield* finish(ctx, slot, { ...rendered, parts: rendered.shots, footage }, expected)
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
        const expected = Effect.gen(function*() {
          const sources = yield* sourceTexts([plan.transcript, ...(plan.sources ?? []).map((s) => s.transcript)])
          return cutReadBackPlan(plan, sources, { closingWanted: yield* closingWanted(ctx), durationS: rendered.durationS })
        })
        yield* finish(ctx, slot, { ...rendered, parts: rendered.sections, footage }, expected)
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
        const expected = Effect.map(sourceTexts(plan.videos.map((v) => v.transcript)), (sources) => rankingReadBackPlan(plan, sources, rendered.durationS))
        yield* finish(ctx, slot, { ...rendered, parts: rendered.shots, footage }, expected)
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
  ).pipe(Layer.provide([Artifacts.layer, RenderEngine.layer, Projects.layer, ProjectSources.layer, SourcePieces.layer, Presets.layer, NodeServices.layer]))
}
