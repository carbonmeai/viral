import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { CutPlan } from "./cut-plan.ts"
import { PublishedShort } from "./metadata.ts"
import { Preset } from "./presets.ts"
import { Project, ProjectId, ProjectNotFound } from "./projects.ts"
import { RenderedShort } from "./render.ts"
import { Run, RunRequest, StageRun } from "./runs.ts"
import { Script } from "./script.ts"
import { ShotPlan } from "./shot-plan.ts"
import { Source } from "./sources.ts"
import { TranscriptWord } from "./transcript.ts"
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
  render: Schema.NullOr(Schema.Struct({ ...at, render: RenderedShort })),
  metadata: Schema.NullOr(Schema.Struct({ ...at, metadata: PublishedShort })),
  // the long video's file, relative to its folder, for playing the real lines
  sourceVideo: Schema.NullOr(Schema.String)
})
export type ShortWorkspace = typeof ShortWorkspace.Type

export class ShortWorkspaceRpcs extends RpcGroup.make(
  Rpc.make("GetShortWorkspace", { payload: { projectId: ProjectId }, success: ShortWorkspace, error: ProjectNotFound }),
  // Checks an edited script against the approach and the transcript before it's sent to the script gate, so a
  // problem is shown instead of failing the run. Empty problems = good to send.
  Rpc.make("CheckScriptEdit", {
    payload: { projectId: ProjectId, script: Script },
    success: Schema.Struct({ problems: Schema.Array(Schema.String) }),
    error: ProjectNotFound
  })
) {}
