import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { MusicTrackId, MusicTrackNotFound } from "./music-library.ts"
import { ProjectId, ProjectNotFound } from "./projects.ts"
import { Run } from "./runs.ts"

// A part of the library song a short's bed plays: `from`–`to` in the song, starting at `at` in the short.
// groove: the build's first bars, looped until the build can start; build: the bars leading into the drop;
// drop: from the drop to the end; drop-loop: the drop's bars again, when the song ends before the short.
// (An arranged bed names its parts the same way: before the drop, looped is groove and once is build; from the
// drop on, the first play is drop and its repeats drop-loop.)
export const MusicBedSegment = Schema.Struct({
  kind: Schema.Literals(["groove", "build", "drop", "drop-loop"]),
  from: Schema.Finite,
  to: Schema.Finite,
  at: Schema.Finite
})
export type MusicBedSegment = typeof MusicBedSegment.Type

// Where a block of an arrangement starts: straight after the block before it, on the short's drop word (so it
// follows the drop word when that changes), or pinned to a voiceover word (index into the voiceover's words).
export const MusicBlockStart = Schema.Union([Schema.Literals(["after", "drop"]), Schema.Struct({ word: Schema.Int })])
export type MusicBlockStart = typeof MusicBlockStart.Type

// A block of the song: its bars `fromBar`–`toBar` (bar 0 is the earliest whole bar before the song's drop, so
// the drop sits on a bar line), played `loops` times in a row.
export const MusicBlock = Schema.Struct({
  fromBar: Schema.Int,
  toBar: Schema.Int,
  loops: Schema.Int,
  start: MusicBlockStart
})
export type MusicBlock = typeof MusicBlock.Type

// How a short's bed is put together from its song, in playing order. Blocks before the first pinned one end
// exactly on it (the first of them loops to fill the start); between pins the last block loops in whole bars and
// is cut, under a short crossfade, where the next pinned block starts; the last block loops to the short's end.
export const MusicArrangement = Schema.Struct({ blocks: Schema.Array(MusicBlock) })
export type MusicArrangement = typeof MusicArrangement.Type

// The most blocks an arrangement may have.
export const MAX_MUSIC_BLOCKS = 12

// A block as the bed plays it: its bars in song seconds (`fromS`–`toS`), and where it plays in the short
// (`atS`–`endS`, its loops and any fill or cut included; null when it isn't heard at all).
export const MusicBedBlock = Schema.Struct({
  ...MusicBlock.fields,
  fromS: Schema.Finite,
  toS: Schema.Finite,
  atS: Schema.NullOr(Schema.Finite),
  endS: Schema.NullOr(Schema.Finite)
})
export type MusicBedBlock = typeof MusicBedBlock.Type

// The arrangement a bed was made from: the automatic one (the build looped so the drop lands on the drop word)
// or yours. `dropBar` is the song's drop on the bar grid, `songBars` its whole bars.
export const MusicBedArrangement = Schema.Struct({
  automatic: Schema.Boolean,
  dropBar: Schema.Int,
  songBars: Schema.Int,
  blocks: Schema.Array(MusicBedBlock)
})
export type MusicBedArrangement = typeof MusicBedArrangement.Type

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
  segments: Schema.Array(MusicBedSegment),
  // absent on beds fitted before arrangements existed
  arrangement: Schema.optionalKey(MusicBedArrangement)
})
export type MusicBed = typeof MusicBed.Type

// An arrangement that can't be played, in plain words (one problem per line).
export class MusicArrangementInvalid extends Schema.TaggedError<MusicArrangementInvalid>()("MusicArrangementInvalid", {
  problems: Schema.Array(Schema.String)
}) {}

// A preview bed couldn't be made (the fit script failed).
export class MusicPreviewFailed extends Schema.TaggedError<MusicPreviewFailed>()("MusicPreviewFailed", {
  message: Schema.String
}) {}

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
  // A different song drops the short's arrangement (back to automatic); a new drop word keeps it.
  Rpc.make("RefitMusic", {
    payload: {
      projectId: ProjectId,
      trackId: Schema.NullOr(MusicTrackId),
      dropWord: Schema.optionalKey(Schema.NullOr(Schema.Int))
    },
    success: Run,
    error: Schema.Union([ProjectNotFound, MusicTrackNotFound])
  }),
  // Sets the short's music arrangement (null: back to automatic), checked first, then re-runs the short from
  // assemble so the new bed is fitted.
  Rpc.make("ArrangeMusic", {
    payload: { projectId: ProjectId, arrangement: Schema.NullOr(MusicArrangement) },
    success: Run,
    error: Schema.Union([ProjectNotFound, MusicArrangementInvalid])
  }),
  // Makes a bed for a proposed arrangement (null: the automatic one) without changing the short, to listen to
  // before applying: a temporary wav (replaced by the next preview) and how it was laid out.
  Rpc.make("PreviewMusicArrangement", {
    payload: { projectId: ProjectId, arrangement: Schema.NullOr(MusicArrangement) },
    success: Schema.Struct({ bed: MusicBed, media: Schema.String }),
    error: Schema.Union([ProjectNotFound, MusicArrangementInvalid, MusicPreviewFailed])
  })
) {}
