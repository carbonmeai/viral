import { NodeServices } from "@effect/platform-node"
import type { ArtifactOwner, JobEvent, SourceArtifactKind, SourceId, SourceNotFound, SourceStage } from "@viral/contracts"
import { Context, Effect, Layer, Option, Path, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ContactSheets, OVERVIEW } from "../contact-sheet/contact-sheets.ts"
import { Transcriber } from "../transcribe/transcriber.ts"
import { SourceFetcher } from "./source-fetcher.ts"
import { Sources } from "./sources.ts"

// `code`: "not-ready" when an earlier stage hasn't run, otherwise the failing stage's own code.
export class SourceStageError extends Schema.TaggedError<SourceStageError>()("SourceStageError", {
  stage: Schema.String,
  code: Schema.String,
  message: Schema.String
}) {}

type Emit = (event: JobEvent) => Effect.Effect<void>

const ARTIFACT: Record<SourceStage, SourceArtifactKind> = {
  source: "source-video",
  transcribe: "transcript",
  "contact-sheet": "contact-sheet"
}

// Runs the stages that work on the long video itself. Each stage's output is a versioned source artifact,
// so every short made from the source reuses it; a stage that already has its artifact is skipped unless
// forced, and forcing adds a new version instead of overwriting.
export class SourceStages extends Context.Service<SourceStages, {
  run(id: SourceId, stage: SourceStage, force: boolean, emit: Emit): Effect.Effect<void, SourceStageError | SourceNotFound>
}>()("@viral/server/sources/source-stages/SourceStages") {
  static readonly layer = Layer.effect(
    SourceStages,
    Effect.gen(function*() {
      const sources = yield* Sources
      const artifacts = yield* Artifacts
      const fetcher = yield* SourceFetcher
      const transcriber = yield* Transcriber
      const sheets = yield* ContactSheets
      const path = yield* Path.Path

      const stageError = (stage: SourceStage) => (error: { readonly code: string; readonly message: string }) =>
        new SourceStageError({ stage, code: error.code, message: error.message })

      // The source video every later stage reads.
      const sourceVideo = Effect.fn("SourceStages.sourceVideo")(function*(owner: ArtifactOwner, stage: SourceStage) {
        const video = yield* artifacts.latest(owner, "source-video")
        const file = Option.flatMapNullishOr(video, artifacts.resolve)
        if (Option.isNone(file)) {
          return yield* new SourceStageError({ stage, code: "not-ready", message: "run the source stage first" })
        }
        return file.value
      })

      const run = Effect.fn("SourceStages.run")(function*(id: SourceId, stage: SourceStage, force: boolean, emit: Emit) {
        const source = yield* sources.get(id)
        const owner: ArtifactOwner = { _tag: "Source", id }

        const existing = yield* artifacts.latest(owner, ARTIFACT[stage])
        if (Option.isSome(existing) && !force) {
          return yield* emit({ _tag: "StageSkipped", stage, reason: `already done (v${existing.value.version})` })
        }
        yield* emit({ _tag: "StageStarted", stage })

        const artifact = yield* Effect.gen(function*() {
          switch (stage) {
            case "source": {
              const slot = yield* artifacts.allocate(owner, "source-video")
              const fetched = yield* fetcher.fetch(source.origin, slot.dir, emit).pipe(Effect.mapError(stageError(stage)))
              yield* sources.recordMetadata(id, {
                title: fetched.title,
                channel: fetched.channel,
                url: fetched.url,
                durationS: fetched.duration_s
              })
              return yield* artifacts.record(slot, { data: fetched, path: path.join(slot.relDir, fetched.path) })
            }
            case "transcribe": {
              const video = yield* sourceVideo(owner, stage)
              const slot = yield* artifacts.allocate(owner, "transcript")
              const result = yield* transcriber.transcribe(video, slot.dir, emit).pipe(Effect.mapError(stageError(stage)))
              return yield* artifacts.record(slot, { data: result, path: path.join(slot.relDir, "transcript.json") })
            }
            case "contact-sheet": {
              const video = yield* sourceVideo(owner, stage)
              const slot = yield* artifacts.allocate(owner, "contact-sheet")
              const set = yield* sheets.make(video, slot.dir, OVERVIEW, emit).pipe(Effect.mapError(stageError(stage)))
              return yield* artifacts.record(slot, { data: set, path: slot.relDir })
            }
          }
        })
        yield* emit({ _tag: "Completed", output: artifacts.resolve(artifact) ?? `${artifact.kind} v${artifact.version}` })
      })

      return SourceStages.of({ run })
    })
  ).pipe(
    Layer.provide([Sources.layer, Artifacts.layer, SourceFetcher.layer, Transcriber.layer, ContactSheets.layer, NodeServices.layer])
  )
}
