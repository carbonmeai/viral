import { NodeServices } from "@effect/platform-node"
import { type FrameAt, type SourceId, SourceNotFound } from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ViralHome } from "../home/viral-home.ts"
import { Sources } from "../sources/sources.ts"

// The most stills one ask returns, so a wide span can't start hundreds of extractions.
export const MAX_FRAMES = 61
const FOLDER = "frames-around"
const WIDTH = 320

// The source seconds a picker shows: every `every` seconds within `span` either side of `t`, on the `every` grid
// so neighbouring asks share stills, inside the video, at most MAX_FRAMES around `t`.
export const frameTimes = (t: number, span: number, every: number, duration: number | null): ReadonlyArray<number> => {
  const step = every > 0 ? every : 1
  const last = duration === null ? Number.POSITIVE_INFINITY : Math.max(0, duration - 0.05)
  const times: Array<number> = []
  for (let k = Math.ceil((t - Math.abs(span)) / step); k * step <= t + Math.abs(span); k++) {
    const at = Math.round(k * step * 1000) / 1000
    if (at >= 0 && at <= last) times.push(at)
  }
  // keep the ones nearest `t` when there are too many
  return times.length <= MAX_FRAMES
    ? times
    : [...times].sort((a, b) => Math.abs(a - t) - Math.abs(b - t)).slice(0, MAX_FRAMES).sort((a, b) => a - b)
}

// Stills of a long video around a moment, for picking a shot's frame. Each still is extracted once, at exactly its
// second, into the video's own folder (frames-around/<milliseconds>.jpg), and kept for the next ask.
export class FramesAround extends Context.Service<FramesAround, {
  list(sourceId: SourceId, t: number, span: number, every: number): Effect.Effect<ReadonlyArray<FrameAt>, SourceNotFound>
}>()("@viral/server/contact-sheet/frames-around/FramesAround") {
  static readonly layer = Layer.effect(
    FramesAround,
    Effect.gen(function*() {
      const sources = yield* Sources
      const artifacts = yield* Artifacts
      const home = yield* ViralHome
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const still = Effect.fn("FramesAround.still")(function*(video: string, dir: string, t: number) {
        const file = `${Math.round(t * 1000)}.jpg`
        const target = path.join(dir, file)
        if (!(yield* fs.exists(target).pipe(Effect.orElseSucceed(() => false)))) {
          const temp = path.join(dir, `.${file}`)
          const exit = yield* spawner.exitCode(ChildProcess.make("ffmpeg", [
            "-y", "-loglevel", "error", "-ss", t.toFixed(3), "-i", video, "-frames:v", "1", "-vf", `scale=${WIDTH}:-2`, "-q:v", "4", "-f", "image2", temp
          ])).pipe(Effect.orElseSucceed(() => ChildProcessSpawner.ExitCode(1)))
          // a moment ffmpeg can't decode (past the end) is left out rather than failing the whole ask
          if (exit !== ChildProcessSpawner.ExitCode(0)) return Option.none<FrameAt>()
          yield* fs.rename(temp, target).pipe(Effect.orElseSucceed(() => undefined))
        }
        return Option.some<FrameAt>({ t, path: `${FOLDER}/${file}` })
      })

      const list = Effect.fn("FramesAround.list")(function*(sourceId: SourceId, t: number, span: number, every: number) {
        const source = yield* sources.get(sourceId)
        const video = Option.flatMapNullishOr(yield* artifacts.latest({ _tag: "Source", id: sourceId }, "source-video"), artifacts.resolve)
        if (Option.isNone(video)) return []
        const dir = path.join(home.sourceDir(sourceId), FOLDER)
        yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.orDie)
        const frames = yield* Effect.forEach(frameTimes(t, span, every, source.durationS), (at) => still(video.value, dir, at), {
          concurrency: 4
        })
        return frames.flatMap(Option.toArray)
      })

      return FramesAround.of({ list })
    })
  ).pipe(Layer.provide([Sources.layer, Artifacts.layer, ViralHome.layer, NodeServices.layer]))
}
