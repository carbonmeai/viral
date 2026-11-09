import { NodeServices } from "@effect/platform-node"
import type { SourceOrigin } from "@viral/contracts"
import { Context, Effect, Layer, Path, Schema } from "effect"
import { ScriptRunner } from "../script-runner/script-runner.ts"

export class FetchError extends Schema.TaggedError<FetchError>()("FetchError", {
  code: Schema.String,
  message: Schema.String
}) {}

// Reports progress: a percentage (null when unknown) and an optional message for the person watching.
type Progress = (pct: number | null, message?: string) => Effect.Effect<void>

export const FetchedSource = Schema.Struct({
  // relative to the folder it was fetched into
  path: Schema.String,
  title: Schema.NullOr(Schema.String),
  channel: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  duration_s: Schema.Finite,
  // the video's size: downloads are 1080p when the site has it, else 720p, never above 1080p
  width: Schema.NullOr(Schema.Int),
  height: Schema.NullOr(Schema.Int),
  // a 480p copy for reading (a link found by research); the seconds a short uses are fetched in 1080p (SourcePieces)
  scan: Schema.optionalKey(Schema.Boolean)
})
export type FetchedSource = typeof FetchedSource.Type

const Line = Schema.fromJsonString(Schema.Union([
  Schema.Struct({ type: Schema.Literal("progress"), pct: Schema.Finite }),
  Schema.Struct({ type: Schema.Literal("log"), message: Schema.String }),
  Schema.Struct({ type: Schema.Literal("done"), ...FetchedSource.fields })
]))

// Brings a long video into a folder as source.mp4: downloaded with Viral's own yt-dlp for a URL (a 480p scan when the link
// asks for one), hard-linked or copied for a local file.
export class SourceFetcher extends Context.Service<SourceFetcher, {
  fetch(origin: SourceOrigin, outDir: string, progress: Progress): Effect.Effect<FetchedSource, FetchError>
}>()("@viral/server/sources/source-fetcher/SourceFetcher") {
  static readonly layer = Layer.effect(
    SourceFetcher,
    Effect.gen(function*() {
      const scripts = yield* ScriptRunner
      const path = yield* Path.Path

      const fetch = Effect.fn("SourceFetcher.fetch")(function*(origin: SourceOrigin, outDir: string, progress: Progress) {
        const from = origin._tag === "Url" ? ["--url", origin.url, ...(origin.scan === true ? ["--scan"] : [])] : ["--file", origin.path]
        return yield* scripts.run(
          [path.join(import.meta.dirname, "fetch-source.py"), ...from, "--out-dir", outDir],
          Schema.decodeEffect(Line),
          (line): Effect.Effect<FetchedSource | undefined> => {
            if (line.type === "progress") {
              return progress(line.pct).pipe(Effect.as(undefined))
            }
            if (line.type === "log") return progress(null, line.message).pipe(Effect.as(undefined))
            const { type: _, ...fetched } = line
            return Effect.succeed(fetched)
          }
        ).pipe(Effect.mapError((error) => new FetchError({ code: error.code, message: error.message })))
      })

      return SourceFetcher.of({ fetch })
    })
  ).pipe(Layer.provide([ScriptRunner.layer, NodeServices.layer]))
}
