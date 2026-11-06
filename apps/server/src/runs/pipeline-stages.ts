import type { RunOwner } from "@viral/contracts"
import { Effect, Layer } from "effect"
import { AdsStage } from "../ads/ads-stage.ts"
import { Projects } from "../projects/projects.ts"
import { ScriptStage } from "../script/script-stage.ts"
import { SourceStages } from "../sources/source-stages.ts"
import { StoryStage } from "../story/story-stage.ts"
import { StageFailure, StageRegistry } from "./stages.ts"

// The real stage lists. A source run is source → transcribe → contact-sheet → ads → story;
// a narrated short's run is script → (voice → shots → assemble → render → metadata, as they are built).
export const PipelineStagesLive = Layer.effect(StageRegistry, Effect.gen(function*() {
  const source = yield* SourceStages
  const ads = yield* AdsStage
  const story = yield* StoryStage
  const script = yield* ScriptStage
  const projects = yield* Projects
  const stagesFor = Effect.fn("StageRegistry.stagesFor")(function*(owner: RunOwner) {
    if (owner._tag === "Source") return [...source.stages, ads.stage, story.stage]
    const project = yield* projects.get(owner.id).pipe(
      Effect.mapError(() => new StageFailure({ stage: "script", code: "not-found", message: `no project ${owner.id}` }))
    )
    if (project.format === "cut-down") {
      return yield* new StageFailure({ stage: "sections", code: "not-built", message: "cut-down shorts aren't built yet" })
    }
    // narrated: the stages after the script join as they are built
    return [script.stage]
  })
  return StageRegistry.of({ stagesFor })
})).pipe(Layer.provide([SourceStages.layer, AdsStage.layer, StoryStage.layer, ScriptStage.layer, Projects.layer]))
