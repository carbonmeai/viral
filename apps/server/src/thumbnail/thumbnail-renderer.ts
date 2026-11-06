import { NodeServices } from "@effect/platform-node"
import { ThumbConfig } from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Path, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import { ScriptRunner } from "../script-runner/script-runner.ts"

// `code`: the script's ("frame", "crop", "source"), the runner's ("spawn", "exit"), "config" when the config
// can't be written, or "probe" when the video's size can't be read.
export class ThumbnailError extends Schema.TaggedError<ThumbnailError>()("ThumbnailError", {
  code: Schema.String,
  message: Schema.String
}) {}

const ConfigJson = Schema.fromJsonString(ThumbConfig)
const Line = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ type: Schema.Literal("progress"), step: Schema.Literals(["background", "hero", "inset", "text"]) }),
  Schema.Struct({ type: Schema.Literal("done"), output: Schema.String, width: Schema.Int, height: Schema.Int })
]))
const Probe = Schema.fromJsonString(Schema.Struct({
  streams: Schema.Array(Schema.Struct({ width: Schema.Int, height: Schema.Int })),
  format: Schema.Struct({ duration: Schema.optionalKey(Schema.String) })
}))

// Draws thumbnails with render-thumbnail.py (the viral-shorts skill's layout), and reads a video's frame size
// (for turning fractional crops into pixels) and length.
export class ThumbnailRenderer extends Context.Service<ThumbnailRenderer, {
  // writes `config` next to `out` as <name>.json and renders it to `out` (a jpg); returns the jpg's path
  render(config: ThumbConfig, out: string): Effect.Effect<string, ThumbnailError>
  // the video's frame size and length
  probe(video: string): Effect.Effect<{ readonly width: number; readonly height: number; readonly durationS: number }, ThumbnailError>
}>()("@viral/server/thumbnail/thumbnail-renderer/ThumbnailRenderer") {
  static readonly layer = Layer.effect(
    ThumbnailRenderer,
    Effect.gen(function*() {
      const scripts = yield* ScriptRunner
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const fail = (code: string) => (error: { readonly message: string }) => new ThumbnailError({ code, message: error.message })

      const render = Effect.fn("ThumbnailRenderer.render")(function*(config: ThumbConfig, out: string) {
        const configFile = out.replace(/\.jpe?g$/i, "") + ".json"
        yield* fs.makeDirectory(path.dirname(out), { recursive: true }).pipe(Effect.mapError(fail("config")))
        yield* Schema.encodeEffect(ConfigJson)(config).pipe(
          Effect.flatMap((json) => fs.writeFileString(configFile, json)),
          Effect.mapError(fail("config"))
        )
        return yield* scripts.run(
          [path.join(import.meta.dirname, "render-thumbnail.py"), configFile, "--out", out],
          Schema.decodeEffect(Line),
          (line) => Effect.succeed(line.type === "done" ? line.output : undefined)
        ).pipe(Effect.mapError((error) => new ThumbnailError({ code: error.code, message: error.message })))
      })

      const probe = Effect.fn("ThumbnailRenderer.probe")(function*(video: string) {
        const out = yield* spawner.string(ChildProcess.make("ffprobe", [
          "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", video
        ])).pipe(Effect.mapError(fail("probe")))
        const probed = yield* Schema.decodeEffect(Probe)(out).pipe(Effect.mapError(fail("probe")))
        const stream = probed.streams[0]
        if (stream === undefined) return yield* new ThumbnailError({ code: "probe", message: `no video stream in ${video}` })
        return { width: stream.width, height: stream.height, durationS: Number(probed.format.duration ?? 0) }
      })

      return ThumbnailRenderer.of({ render, probe })
    })
  ).pipe(Layer.provide([ScriptRunner.layer, NodeServices.layer]))
}
