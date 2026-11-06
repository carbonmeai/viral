import type { RunOwner } from "@viral/contracts"
import { Effect, Layer } from "effect"
import { AdsStage } from "../ads/ads-stage.ts"
import { AssembleStage } from "../assemble/assemble-stage.ts"
import { MetadataStage } from "../metadata/metadata-stage.ts"
import { Projects } from "../projects/projects.ts"
import { RenderStage } from "../render/render-stage.ts"
import { ScriptStage } from "../script/script-stage.ts"
import { SectionsStage } from "../sections/sections-stage.ts"
import { ShotsStage } from "../shots/shots-stage.ts"
import { SourceStages } from "../sources/source-stages.ts"
import { StoryStage } from "../story/story-stage.ts"
import { VoiceStage } from "../voice/voice-stage.ts"
import { StageFailure, StageRegistry } from "./stages.ts"

// The real stage lists. A source run is source → transcribe → contact-sheet → ads → story;
// a narrated short's run is script → voice → shots → assemble → render → metadata; a cut-down short's is
// sections → assemble → render → metadata.
export const PipelineStagesLive = Layer.effect(StageRegistry, Effect.gen(function*() {
  const source = yield* SourceStages
  const ads = yield* AdsStage
  const story = yield* StoryStage
  const script = yield* ScriptStage
  const voice = yield* VoiceStage
  const shots = yield* ShotsStage
  const assemble = yield* AssembleStage
  const render = yield* RenderStage
  const metadata = yield* MetadataStage
  const sections = yield* SectionsStage
  const projects = yield* Projects
  const stagesFor = Effect.fn("StageRegistry.stagesFor")(function*(owner: RunOwner) {
    if (owner._tag === "Source") return [...source.stages, ads.stage, story.stage]
    const project = yield* projects.get(owner.id).pipe(
      Effect.mapError(() => new StageFailure({ stage: "script", code: "not-found", message: `no project ${owner.id}` }))
    )
    if (project.format === "cut-down") return [sections.stage, assemble.cut, render.cut, metadata.stage]
    return [script.stage, voice.stage, shots.stage, assemble.narrated, render.narrated, metadata.stage]
  })
  return StageRegistry.of({ stagesFor })
})).pipe(Layer.provide([SourceStages.layer, AdsStage.layer, StoryStage.layer, ScriptStage.layer, VoiceStage.layer, ShotsStage.layer, AssembleStage.layer, RenderStage.layer, MetadataStage.layer, SectionsStage.layer, Projects.layer]))
