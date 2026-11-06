import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { MusicTrackId, MusicTrackNotFound } from "./music-library.ts"
import { ProjectId, ProjectNotFound } from "./projects.ts"
import { Run } from "./runs.ts"

// A part of the library song a short's bed plays: `from`–`to` in the song, starting at `at` in the short.
// groove: the build's first bars, looped until the build can start; build: the bars leading into the drop;
// drop: from the drop to the end; drop-loop: the drop's bars again, when the song ends before the short.
export const MusicBedSegment = Schema.Struct({
  kind: Schema.Literals(["groove", "build", "drop", "drop-loop"]),
  from: Schema.Finite,
  to: Schema.Finite,
  at: Schema.Finite
})
export type MusicBedSegment = typeof MusicBedSegment.Type

// A short's own music, fitted from a library song at assemble time so the drop lands on a chosen word. Saved
// with the short (the `music-bed` artifact, a wav); the library song is never changed.
export const MusicBed = Schema.Struct({
  trackId: MusicTrackId,
  trackTitle: Schema.String,
  durationS: Schema.Finite,
  // where the drop lands in the short, and the voiceover word it lands on
  dropAtS: Schema.Finite,
  dropWord: Schema.NullOr(Schema.Int),
  dropWordText: Schema.NullOr(Schema.String),
  // the drop's time in the song, and one bar's length
  songDropS: Schema.Finite,
  barS: Schema.Finite,
  segments: Schema.Array(MusicBedSegment)
})
export type MusicBed = typeof MusicBed.Type

export class MusicBedsRpcs extends RpcGroup.make(
  // The short's fitted bed and its file as the media route serves it (a path relative to the Viral home), or
  // null when it has no music.
  Rpc.make("GetMusicBed", {
    payload: { projectId: ProjectId },
    success: Schema.NullOr(Schema.Struct({ bed: MusicBed, media: Schema.String })),
    error: ProjectNotFound
  }),
  // Changes the short's song (null: no music) and/or the word the drop lands on (null: back to the default,
  // the start of the last narrated line), then re-runs the short from assemble. The library song is untouched.
  Rpc.make("RefitMusic", {
    payload: {
      projectId: ProjectId,
      trackId: Schema.NullOr(MusicTrackId),
      dropWord: Schema.optionalKey(Schema.NullOr(Schema.Int))
    },
    success: Run,
    error: Schema.Union([ProjectNotFound, MusicTrackNotFound])
  })
) {}
