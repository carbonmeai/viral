import { NodeServices } from "@effect/platform-node"
import { type RankingFraming, type RankingProposal, type SourceId } from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { ScriptRunner } from "../script-runner/script-runner.ts"
import { Settings } from "../settings/settings.ts"
import { framingKey, type RankingDraft } from "./moment-rules.ts"

const Framing = Schema.Literals(["window", "fill"])
const FramingLine = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ type: Schema.Literal("frame"), t: Schema.Finite, framing: Framing }),
  Schema.Struct({ type: Schema.Literal("done"), framing: Framing, width: Schema.Int, height: Schema.Int, pillarboxed: Schema.Int, sampled: Schema.Int })
]))
const StoryboardLine = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ type: Schema.Literal("progress"), done: Schema.Int, total: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("done"), tiles: Schema.Int })
]))
const StatsLine = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ type: Schema.Literal("pair"), index: Schema.Int, first_luma: Schema.Finite, last_luma: Schema.Finite, similarity: Schema.Finite }),
  Schema.Struct({ type: Schema.Literal("done"), pairs: Schema.Int })
]))
const StatsSpec = Schema.fromJsonString(Schema.Struct({ pairs: Schema.Array(Schema.Array(Schema.String)) }))
const StoryboardSpec = Schema.fromJsonString(Schema.Struct({
  cols: Schema.Int,
  tiles: Schema.Array(Schema.Struct({
    t: Schema.Finite,
    label: Schema.String,
    kind: Schema.Literals(["shot", "real"]),
    file: Schema.String,
    video: Schema.optionalKey(Schema.String)
  }))
}))

// A shot's first and last frame, relative to the folder they were drawn in, and how they compare.
export interface ShotFrames {
  readonly first: string
  readonly last: string
  // mean brightness, 0–1
  readonly firstLuma: number
  readonly lastLuma: number
  // how alike their colours are, 0–1
  readonly similarity: number
}

// The drawn frames of a ranking, by entry then shot (as the draft lists them), and the storyboard of them all in
// playing order; null when they couldn't be drawn.
export interface DrawnRanking {
  readonly storyboard: string
  readonly shots: ReadonlyArray<ReadonlyArray<ShotFrames>>
}

// Below this, a shot's first and last frames look like different scenes; below this brightness a frame is black.
export const DRIFT_SIMILARITY = 0.4
export const BLACK_LUMA = 0.06

export const frameFile = (rank: number, shot: number, end: "first" | "last") =>
  `frames/rank-${String(rank).padStart(2, "0")}-shot-${shot + 1}-${end}.jpg`

// The settings key a video's detected framing is kept under (it doesn't change).
const framingSetting = (sourceId: SourceId) => `source.${sourceId}.ranking-framing`

// What a ranking needs from its videos' pictures: the framing each moment calls for (a 4:3 window for landscape
// footage, filling the screen for upright phone footage), and every shot's first and last frame drawn, compared and
// stitched into a storyboard in playing order.
export class RankingFrames extends Context.Service<RankingFrames, {
  // a video's overall framing (the majority of its frames), detected once and kept
  ofVideo(sourceId: SourceId, video: string): Effect.Effect<RankingFraming | null>
  // the framing at each shot's moment that doesn't set its own, by framingKey; videos V1 first
  atShots(videos: ReadonlyArray<string>, proposal: RankingProposal): Effect.Effect<ReadonlyMap<string, RankingFraming>>
  // draws every shot's first and last frame into `dir` and compares them; null when it couldn't
  draw(videos: ReadonlyArray<string>, draft: RankingDraft, dir: string): Effect.Effect<DrawnRanking | null>
}>()("@viral/server/moments/ranking-frames/RankingFrames") {
  static readonly layer = Layer.effect(
    RankingFrames,
    Effect.gen(function*() {
      const scripts = yield* ScriptRunner
      const settings = yield* Settings
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const script = (name: string) => path.join(import.meta.dirname, name)

      const detect = (video: string, times: ReadonlyArray<number>) => {
        const frames: Array<RankingFraming> = []
        return scripts.run(
          [script("detect-framing.py"), video, ...times.map((t) => t.toFixed(2))],
          Schema.decodeEffect(FramingLine),
          (line) => {
            if (line.type === "frame") {
              frames.push(line.framing)
              return Effect.undefined
            }
            return Effect.succeed({ overall: line.framing, frames })
          }
        )
      }

      const ofVideo = Effect.fn("RankingFrames.ofVideo")(function*(sourceId: SourceId, video: string) {
        const kept = yield* settings.get(framingSetting(sourceId), Framing)
        if (Option.isSome(kept)) return kept.value
        const detected = yield* detect(video, []).pipe(Effect.option)
        if (Option.isNone(detected)) return null
        yield* settings.set(framingSetting(sourceId), detected.value.overall)
        return detected.value.overall
      })

      const atShots = Effect.fn("RankingFrames.atShots")(function*(videos: ReadonlyArray<string>, proposal: RankingProposal) {
        const found = new Map<string, RankingFraming>()
        const bySource = new Map<number, Array<{ readonly start: number; readonly end: number }>>()
        for (const entry of proposal.entries) {
          for (const shot of entry.shots) {
            if (shot.framing !== undefined || !(shot.end > shot.start)) continue
            const source = entry.source ?? 0
            bySource.set(source, [...(bySource.get(source) ?? []), { start: shot.start, end: shot.end }])
          }
        }
        // one detect-framing run per video, a few at once
        yield* Effect.forEach([...bySource], ([source, shots]) => {
          const video = videos[source]
          if (video === undefined) return Effect.void
          return detect(video, shots.map((s) => (s.start + s.end) / 2)).pipe(
            Effect.tap(({ frames }) => Effect.sync(() => shots.forEach((s, i) => {
              const framing = frames[i]
              if (framing !== undefined) found.set(framingKey(source, s.start, s.end), framing)
            }))),
            Effect.ignore
          )
        }, { discard: true, concurrency: 4 })
        return found
      })

      const draw = Effect.fn("RankingFrames.draw")(function*(videos: ReadonlyArray<string>, draft: RankingDraft, dir: string) {
        yield* fs.makeDirectory(dir, { recursive: true })
        const byRank = new Map(draft.entries.map((e) => [e.rank, e]))
        // every shot's two frames in playing order, a little inside its ends
        const tiles = draft.order.flatMap((rank) => {
          const entry = byRank.get(rank)
          if (entry === undefined) return []
          const video = videos[entry.source ?? 0] ?? videos[0]!
          return entry.shots.flatMap((shot, k) => [
            { t: shot.start + 0.05, label: `#${rank} ${shot.role} first`, kind: "shot" as const, file: frameFile(rank, k, "first"), video },
            { t: Math.max(shot.start + 0.05, shot.end - 0.1), label: `#${rank} ${shot.role} last`, kind: "real" as const, file: frameFile(rank, k, "last"), video }
          ])
        })
        if (tiles.length === 0) return null
        const spec = path.join(dir, "storyboard.json")
        yield* Schema.encodeEffect(StoryboardSpec)({ cols: 6, tiles }).pipe(Effect.flatMap((json) => fs.writeFileString(spec, json)))
        yield* scripts.run(
          [path.join(import.meta.dirname, "..", "shots", "storyboard.py"), videos[0]!, spec, path.join(dir, "storyboard.png")],
          Schema.decodeEffect(StoryboardLine),
          (line) => Effect.succeed(line.type === "done" ? true : undefined)
        )
        const pairs = draft.entries.flatMap((e) => e.shots.map((_, k) => [frameFile(e.rank, k, "first"), frameFile(e.rank, k, "last")]))
        const statsSpec = path.join(dir, "frame-stats.json")
        yield* Schema.encodeEffect(StatsSpec)({ pairs }).pipe(Effect.flatMap((json) => fs.writeFileString(statsSpec, json)))
        const stats: Array<{ readonly firstLuma: number; readonly lastLuma: number; readonly similarity: number }> = []
        yield* scripts.run([script("frame-stats.py"), statsSpec], Schema.decodeEffect(StatsLine), (line) => {
          if (line.type === "pair") {
            stats[line.index] = { firstLuma: line.first_luma, lastLuma: line.last_luma, similarity: line.similarity }
            return Effect.undefined
          }
          return Effect.succeed(true)
        })
        let i = 0
        const shots = draft.entries.map((e) =>
          e.shots.map((_, k) => {
            const s = stats[i++] ?? { firstLuma: 1, lastLuma: 1, similarity: 1 }
            return { first: frameFile(e.rank, k, "first"), last: frameFile(e.rank, k, "last"), ...s }
          })
        )
        return { storyboard: "storyboard.png", shots } satisfies DrawnRanking
      }, (effect) =>
        effect.pipe(
          Effect.tapError((error) => Effect.logWarning("no ranking frames", { error: String(error) })),
          Effect.orElseSucceed(() => null)
        ))

      return RankingFrames.of({ ofVideo, atShots, draw })
    })
  ).pipe(Layer.provide([ScriptRunner.layer, Settings.layer, NodeServices.layer]))
}

// What the frames say about each shot: a black first or last frame (a problem to fix), or first and last frames
// that look like different scenes (to look at). `name` names a shot in messages.
export const frameFindings = (
  draft: RankingDraft,
  drawn: DrawnRanking,
  name: (rank: number, shot: number) => string
) => {
  const black: Array<string> = []
  const drift: Array<{ readonly entry: number; readonly shot: number; readonly message: string }> = []
  draft.entries.forEach((entry, e) =>
    entry.shots.forEach((_, k) => {
      const frames = drawn.shots[e]?.[k]
      if (frames === undefined) return
      if (frames.firstLuma < BLACK_LUMA) black.push(`${name(entry.rank, k)} starts on a black frame; start it later`)
      if (frames.lastLuma < BLACK_LUMA) black.push(`${name(entry.rank, k)} ends on a black frame; end it earlier`)
      if (frames.similarity < DRIFT_SIMILARITY) {
        drift.push({ entry: e, shot: k, message: `${name(entry.rank, k)}: its first and last frames look like different scenes` })
      }
    })
  )
  return { black, drift }
}
