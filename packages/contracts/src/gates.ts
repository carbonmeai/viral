import { Schema } from "effect"
import { Artifact } from "./artifacts.ts"
import { RenderedShort } from "./render.ts"
import { Script } from "./script.ts"
import { ShotPlan } from "./shot-plan.ts"
import { Voiceover } from "./voices.ts"

// What a gate shows you, one shape per gated stage, so every client renders it the same way.
export const GatePayload = Schema.Union([
  Schema.TaggedStruct("ScriptGate", { script: Script, narrationWords: Schema.Int }),
  // `file`: the take to play
  Schema.TaggedStruct("VoiceGate", { voiceover: Voiceover, file: Schema.NullOr(Schema.String) }),
  // `storyboard`: the stitched image; each shot and real clip also carries its own frame
  Schema.TaggedStruct("ShotsGate", { plan: ShotPlan, storyboard: Schema.NullOr(Schema.String) }),
  // rejecting a render goes back to the shots with your note
  Schema.TaggedStruct("RenderGate", { render: RenderedShort }),
  // a stage with no view of its own: the artifact as stored
  Schema.TaggedStruct("ArtifactGate", { artifact: Artifact })
])
export type GatePayload = typeof GatePayload.Type
