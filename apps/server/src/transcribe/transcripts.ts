import { NodeServices } from "@effect/platform-node"
import { type SourceId, Transcript } from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"

export class TranscriptMissing extends Schema.TaggedError<TranscriptMissing>()("TranscriptMissing", {
  sourceId: Schema.String
}) {}

const fmt = (t: number) => t.toFixed(1)

// Reads a source's current transcript, for the stages that plan from it.
export class Transcripts extends Context.Service<Transcripts, {
  forSource(sourceId: SourceId): Effect.Effect<Transcript, TranscriptMissing>
  // One line per segment with its source seconds, "[1143.7–1145.5] Right now, it's just pain.", so an agent
  // can cite exact times.
  timedText(transcript: Transcript): string
}>()("@viral/server/transcribe/transcripts") {
  static readonly layer = Layer.effect(
    Transcripts,
    Effect.gen(function*() {
      const artifacts = yield* Artifacts
      const fs = yield* FileSystem.FileSystem

      const forSource = Effect.fn("Transcripts.forSource")(function*(sourceId: SourceId) {
        const missing = new TranscriptMissing({ sourceId })
        const artifact = yield* artifacts.latest({ _tag: "Source", id: sourceId }, "transcript")
        const file = Option.flatMapNullishOr(artifact, artifacts.resolve)
        if (Option.isNone(file)) return yield* missing
        const json = yield* fs.readFileString(file.value).pipe(Effect.mapError(() => missing))
        return yield* Schema.decodeEffect(Schema.fromJsonString(Transcript))(json).pipe(Effect.mapError(() => missing))
      })

      const timedText = (transcript: Transcript) =>
        transcript.segments.map((s) => `[${fmt(s.start)}–${fmt(s.end)}] ${s.text}`).join("\n")

      return Transcripts.of({ forSource, timedText })
    })
  ).pipe(Layer.provide([Artifacts.layer, NodeServices.layer]))
}
