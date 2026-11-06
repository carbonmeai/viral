import { NodeServices } from "@effect/platform-node"
import type { ArtifactOwner, SourceId } from "@viral/contracts"
import { Context, Effect, Layer, Option, Path } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ContactSheets, OVERVIEW } from "../contact-sheet/contact-sheets.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { Transcriber } from "../transcribe/transcriber.ts"
import { SourceFetcher } from "./source-fetcher.ts"
import { Sources } from "./sources.ts"

const sourceOf = (ctx: StageContext): SourceId => {
  if (ctx.owner._tag !== "Source") throw new Error("source stages run on a source")
  return ctx.owner.id
}

// The stages that work on the long video itself. Their artifacts are owned by the source, so every short
// made from it reuses them; none needs approval.
export class SourceStages extends Context.Service<SourceStages, {
  readonly stages: ReadonlyArray<StageDefinition>
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

      const failure = (stage: string) => (error: { readonly code: string; readonly message: string }) =>
        new StageFailure({ stage, code: error.code, message: error.message })

      // The source video every later stage reads.
      const sourceVideo = Effect.fn("SourceStages.sourceVideo")(function*(owner: ArtifactOwner, stage: string) {
        const file = Option.flatMapNullishOr(yield* artifacts.latest(owner, "source-video"), artifacts.resolve)
        if (Option.isNone(file)) {
          return yield* new StageFailure({ stage, code: "not-ready", message: "the source video hasn't been fetched" })
        }
        return file.value
      })

      const source: StageDefinition = {
        name: "source",
        artifact: "source-video",
        gate: null,
        run: Effect.fn("SourceStages.source")(function*(ctx) {
          const id = sourceOf(ctx)
          const row = yield* sources.get(id).pipe(Effect.mapError(() => new StageFailure({ stage: "source", code: "not-found", message: `no source ${id}` })))
          const slot = yield* artifacts.allocate(ctx.owner, "source-video")
          const fetched = yield* fetcher.fetch(row.origin, slot.dir, ctx.progress).pipe(Effect.mapError(failure("source")))
          yield* sources.recordMetadata(id, {
            title: fetched.title,
            channel: fetched.channel,
            url: fetched.url,
            durationS: fetched.duration_s
          })
          yield* artifacts.record(slot, { data: fetched, path: path.join(slot.relDir, fetched.path), stageRunId: ctx.stageRunId })
        })
      }

      const transcribe: StageDefinition = {
        name: "transcribe",
        artifact: "transcript",
        gate: null,
        run: Effect.fn("SourceStages.transcribe")(function*(ctx) {
          const video = yield* sourceVideo(ctx.owner, "transcribe")
          const slot = yield* artifacts.allocate(ctx.owner, "transcript")
          const result = yield* transcriber.transcribe(video, slot.dir, ctx.progress).pipe(Effect.mapError(failure("transcribe")))
          yield* artifacts.record(slot, { data: result, path: path.join(slot.relDir, "transcript.json"), stageRunId: ctx.stageRunId })
        })
      }

      const contactSheet: StageDefinition = {
        name: "contact-sheet",
        artifact: "contact-sheet",
        gate: null,
        run: Effect.fn("SourceStages.contactSheet")(function*(ctx) {
          const video = yield* sourceVideo(ctx.owner, "contact-sheet")
          const slot = yield* artifacts.allocate(ctx.owner, "contact-sheet")
          const set = yield* sheets.make(video, slot.dir, OVERVIEW, ctx.progress).pipe(Effect.mapError(failure("contact-sheet")))
          yield* artifacts.record(slot, { data: set, path: slot.relDir, stageRunId: ctx.stageRunId })
        })
      }

      return SourceStages.of({ stages: [source, transcribe, contactSheet] })
    })
  ).pipe(
    Layer.provide([Sources.layer, Artifacts.layer, SourceFetcher.layer, Transcriber.layer, ContactSheets.layer, NodeServices.layer])
  )
}
