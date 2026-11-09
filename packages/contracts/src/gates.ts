import { Schema } from "effect"
import { Artifact } from "./artifacts.ts"
import { CutPlan } from "./cut-plan.ts"
import { RenderedShort } from "./render.ts"
import { Shortlist } from "./research.ts"
import { Script } from "./script.ts"
import { ShotPlan } from "./shot-plan.ts"
import { ThumbConfig } from "./thumb-config.ts"
import { Voiceover } from "./voices.ts"

// What a gate shows you, one shape per gated stage, so every client renders it the same way.
export const GatePayload = Schema.Union([
  Schema.TaggedStruct("ScriptGate", { script: Script, narrationWords: Schema.Int }),
  // `file`: the take to play
  Schema.TaggedStruct("VoiceGate", { voiceover: Voiceover, file: Schema.NullOr(Schema.String) }),
  // `storyboard`: the stitched image; each shot and real clip also carries its own frame
  Schema.TaggedStruct("ShotsGate", { plan: ShotPlan, storyboard: Schema.NullOr(Schema.String) }),
  // a cut-down short's sections: `storyboard` is the stitched image; each section also carries its own frame
  Schema.TaggedStruct("SectionsGate", { plan: CutPlan, storyboard: Schema.NullOr(Schema.String) }),
  // rejecting a render goes back to the shots (or sections) with your note
  Schema.TaggedStruct("RenderGate", { render: RenderedShort }),
  // `image`: the rendered jpg; rejecting redraws it with your note, editing re-renders your changed config
  Schema.TaggedStruct("ThumbnailGate", { config: ThumbConfig, image: Schema.NullOr(Schema.String) }),
  // a research's shortlist: approve to download the videos, edit to approve your changed list, reject to ask the agent
  // for a new list (or another video in one spot) with your note
  Schema.TaggedStruct("ShortlistGate", { shortlist: Shortlist }),
  // a stage with no view of its own: the artifact as stored
  Schema.TaggedStruct("ArtifactGate", { artifact: Artifact })
])
export type GatePayload = typeof GatePayload.Type
