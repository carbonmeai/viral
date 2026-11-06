import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { AdRange } from "./ads.ts"
import { ContactSheetSet } from "./contact-sheets.ts"
import { Project } from "./projects.ts"
import { Run, StageRun } from "./runs.ts"
import { Source, SourceId, SourceNotFound } from "./sources.ts"
import { StoryMap } from "./story.ts"
import { TranscriptProvider } from "./transcript.ts"

// A short made from this video, with the proposal it came from (its index in the story's proposals), or null
// when it wasn't made from one.
export const SourceShort = Schema.Struct({ project: Project, proposal: Schema.NullOr(Schema.Int) })
export type SourceShort = typeof SourceShort.Type

// One line of the transcript, for reading: its source seconds and text (no word timings).
export const TranscriptLine = Schema.Struct({ start: Schema.Finite, end: Schema.Finite, text: Schema.String })
export type TranscriptLine = typeof TranscriptLine.Type

// Everything a video's page shows in one call: the video, how its latest source run went stage by stage,
// its story and proposals, the ranges kept out of shorts, its frames, its transcript, and its shorts.
export const SourceOverview = Schema.Struct({
  source: Source,
  // the latest source run and its stages; null before the first run
  run: Schema.NullOr(Run),
  stages: Schema.Array(StageRun),
  story: Schema.NullOr(StoryMap),
  ads: Schema.Array(AdRange),
  // the latest contact sheets: their version (the media folder is sources/<id>/contact-sheet/v<version>/)
  // and the set, whose stills are one file per frame
  contactSheet: Schema.NullOr(Schema.Struct({ version: Schema.Int, set: ContactSheetSet })),
  transcript: Schema.NullOr(Schema.Struct({
    provider: Schema.NullOr(TranscriptProvider),
    words: Schema.Int,
    lines: Schema.Array(TranscriptLine)
  })),
  shorts: Schema.Array(SourceShort)
})
export type SourceOverview = typeof SourceOverview.Type

export class SourceOverviewRpcs extends RpcGroup.make(
  Rpc.make("GetSourceOverview", { payload: { sourceId: SourceId }, success: SourceOverview, error: SourceNotFound })
) {}
