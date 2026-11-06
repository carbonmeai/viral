import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { CutPlan, SectionsProposal } from "./cut-plan.ts"
import { PublishedShort } from "./metadata.ts"
import { Preset } from "./presets.ts"
import { Project, ProjectId, ProjectNotFound } from "./projects.ts"
import { RenderedShort } from "./render.ts"
import { Run, RunRequest, StageRun } from "./runs.ts"
import { Script } from "./script.ts"
import { ShotPlan, ShotProposal } from "./shot-plan.ts"
import { Source, SourceId, SourceNotFound } from "./sources.ts"
import { TranscriptWord } from "./transcript.ts"
import { ThumbConfig } from "./thumb-config.ts"
import { Thumbnail } from "./thumbnail.ts"
import { Voiceover } from "./voices.ts"

// Each artifact as the editor uses it: which version, and its file relative to the owner's folder (the media
// route serves it at /media/<owner folder>/<path>), or null when it has none.
const at = { version: Schema.Int, path: Schema.NullOr(Schema.String) }

// What a narrated script is checked against for this short's approach, so the editor can show the meters.
export const ScriptLimits = Schema.Struct({
  narrationWords: Schema.Tuple([Schema.Int, Schema.Int]),
  reals: Schema.Tuple([Schema.Int, Schema.Int]),
  realsOnlyAtEnd: Schema.Boolean
})
export type ScriptLimits = typeof ScriptLimits.Type

// Everything a short's editor shows in one call: the short, its style and voice, how its latest run is going (and
// the gate waiting, with what it shows), and the latest version of each thing the run has made.
export const ShortWorkspace = Schema.Struct({
  project: Project,
  source: Source,
  // the style the short is made in (its own, or the default)
  preset: Preset,
  // the ElevenLabs voice its voiceover uses: the short's own, or the style's
  voiceId: Schema.String,
  scriptLimits: Schema.NullOr(ScriptLimits),
  // the latest run of the short and its stage runs; null before the first run
  run: Schema.NullOr(Run),
  stages: Schema.Array(StageRun),
  // the gate the run is waiting on, if any
  pending: Schema.NullOr(RunRequest),
  script: Schema.NullOr(Schema.Struct({ ...at, script: Script })),
  voiceover: Schema.NullOr(Schema.Struct({
    // `path` is vo.wav, relative to the short's folder
    ...at,
    voiceover: Voiceover,
    // the take's words with their times, as spoken
    words: Schema.Array(TranscriptWord)
  })),
  shotPlan: Schema.NullOr(Schema.Struct({ ...at, plan: ShotPlan })),
  cutPlan: Schema.NullOr(Schema.Struct({ ...at, plan: CutPlan })),
  render: Schema.NullOr(Schema.Struct({
    ...at,
    render: RenderedShort,
    // the render's files as the media route serves them: relative to the Viral home (/media/<path>), or null
    media: Schema.Struct({ video: Schema.NullOr(Schema.String), captions: Schema.NullOr(Schema.String), checkSheet: Schema.NullOr(Schema.String) })
  })),
  metadata: Schema.NullOr(Schema.Struct({
    ...at,
    metadata: PublishedShort,
    // the published files in the renders folder, relative to the Viral home; the thumbnail once it's approved
    media: Schema.Struct({
      video: Schema.NullOr(Schema.String),
      captions: Schema.NullOr(Schema.String),
      notes: Schema.NullOr(Schema.String),
      thumbnail: Schema.NullOr(Schema.String)
    }),
    // the same files as absolute paths, for Show in Finder
    files: Schema.Struct({ folder: Schema.String, thumbnail: Schema.NullOr(Schema.String) })
  })),
  // `path` is the jpg, relative to the short's folder
  thumbnail: Schema.NullOr(Schema.Struct({ ...at, thumbnail: Thumbnail })),
  // the long video's file, relative to its folder, for playing the real lines
  sourceVideo: Schema.NullOr(Schema.String),
  // what a cut-down short is cut from and checked against, for editing its sections: the long video's words with
  // their times, its length, the ranges a section may not touch, and the section limits; null for narrated shorts
  cutSource: Schema.NullOr(Schema.Struct({
    words: Schema.Array(TranscriptWord),
    sourceSeconds: Schema.Finite,
    excluded: Schema.Array(Schema.Struct({ start: Schema.Finite, end: Schema.Finite })),
    limits: Schema.Struct({
      minSection: Schema.Finite,
      total: Schema.Tuple([Schema.Finite, Schema.Finite]),
      hookWords: Schema.Int
    })
  }))
})
export type ShortWorkspace = typeof ShortWorkspace.Type

// A still of the long video at a source second, for picking a shot's frame. `path` is relative to the video's
// own folder (the media route serves it at /media/sources/<id>/<path>).
export const FrameAt = Schema.Struct({ t: Schema.Finite, path: Schema.String })
export type FrameAt = typeof FrameAt.Type

export class ShortWorkspaceRpcs extends RpcGroup.make(
  Rpc.make("GetShortWorkspace", { payload: { projectId: ProjectId }, success: ShortWorkspace, error: ProjectNotFound }),
  // Checks an edited script against the approach and the transcript before it's sent to the script gate, so a
  // problem is shown instead of failing the run. Empty problems = good to send.
  Rpc.make("CheckScriptEdit", {
    payload: { projectId: ProjectId, script: Script },
    success: Schema.Struct({ problems: Schema.Array(Schema.String) }),
    error: ProjectNotFound
  }),
  // The same for an edited shot list (frames, framing, speed) before it's sent to the shots gate.
  Rpc.make("CheckShotsEdit", {
    payload: { projectId: ProjectId, proposal: ShotProposal },
    success: Schema.Struct({ problems: Schema.Array(Schema.String) }),
    error: ProjectNotFound
  }),
  // The same for a cut-down short's edited sections (their times, order, framing and hook text).
  Rpc.make("CheckSectionsEdit", {
    payload: { projectId: ProjectId, proposal: SectionsProposal },
    success: Schema.Struct({ problems: Schema.Array(Schema.String) }),
    error: ProjectNotFound
  }),
  // The same for an edited thumbnail config (its words, mostly) before it's sent to the thumbnail gate.
  Rpc.make("CheckThumbnailEdit", {
    payload: { projectId: ProjectId, config: ThumbConfig },
    success: Schema.Struct({ problems: Schema.Array(Schema.String) }),
    error: ProjectNotFound
  }),
  // Stills of the long video every `every` seconds within `span` seconds either side of `t`, extracted on first
  // ask and kept; for the frame picker.
  Rpc.make("ListFramesAround", {
    payload: { sourceId: SourceId, t: Schema.Finite, span: Schema.Finite, every: Schema.Finite },
    success: Schema.Struct({ frames: Schema.Array(FrameAt) }),
    error: SourceNotFound
  })
) {}
