import type { RunOwner, SourceId } from "@viral/contracts"
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
import { SetStoryStage } from "../set-story/set-story-stage.ts"
import { Sources } from "../sources/sources.ts"
import { StoryStage } from "../story/story-stage.ts"
import { ThumbnailStage } from "../thumbnail/thumbnail-stage.ts"
import { VideoSets } from "../video-sets/video-sets.ts"
import { VoiceStage } from "../voice/voice-stage.ts"
import { StageFailure, StageRegistry } from "./stages.ts"

// The real stage lists. A source run is source → transcribe → contact-sheet → ads → story; a video set's run reads
// each of its videos first (their own source runs, through ads), then runs set-story; a short's run first reads any
// of its videos after the first that haven't been (a video added to it);
// a narrated short's run is script → voice → shots → assemble → render → metadata → thumbnail; a cut-down
// short's is sections → assemble → render → metadata → thumbnail.
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
  const thumbnail = yield* ThumbnailStage
  const projects = yield* Projects
  const setStory = yield* SetStoryStage
  const sets = yield* VideoSets
  const sources = yield* Sources
  // each video read (its own source run, through ads) before a video set's story, and before a short's own stages
  // for the videos after its first (a video added to a short is read on its next run; V1 always was)
  const readVideos = (ids: ReadonlyArray<SourceId>, first: number) =>
    Effect.forEach(ids.slice(first), (id, i) =>
      Effect.map(sources.get(id).pipe(Effect.option), (source) => ({
        owner: { _tag: "Source", id } as const,
        through: "ads" as const,
        label: `V${first + i + 1}${source._tag === "Some" && source.value.title !== null ? ` "${source.value.title}"` : ""}`
      })))
  const prerequisites = Effect.fn("StageRegistry.prerequisites")(function*(owner: RunOwner) {
    if (owner._tag === "Project") {
      const project = yield* projects.get(owner.id).pipe(
        Effect.mapError(() => new StageFailure({ stage: "videos", code: "not-found", message: `no project ${owner.id}` }))
      )
      return yield* readVideos(project.sourceIds, 1)
    }
    if (owner._tag !== "Set") return []
    const set = yield* sets.get(owner.id).pipe(
      Effect.mapError(() => new StageFailure({ stage: "set-story", code: "not-found", message: `no video set ${owner.id}` }))
    )
    return yield* readVideos(set.sourceIds, 0)
  })
  const stagesFor = Effect.fn("StageRegistry.stagesFor")(function*(owner: RunOwner) {
    if (owner._tag === "Source") return [...source.stages, ads.stage, story.stage]
    if (owner._tag === "Set") return [setStory.stage]
    const project = yield* projects.get(owner.id).pipe(
      Effect.mapError(() => new StageFailure({ stage: "script", code: "not-found", message: `no project ${owner.id}` }))
    )
    if (project.format === "cut-down") return [sections.stage, assemble.cut, render.cut, metadata.stage, thumbnail.stage]
    return [script.stage, voice.stage, shots.stage, assemble.narrated, render.narrated, metadata.stage, thumbnail.stage]
  })
  return StageRegistry.of({ stagesFor, prerequisites })
})).pipe(Layer.provide([SourceStages.layer, AdsStage.layer, StoryStage.layer, ScriptStage.layer, VoiceStage.layer, ShotsStage.layer, AssembleStage.layer, RenderStage.layer, MetadataStage.layer, SectionsStage.layer, ThumbnailStage.layer, Projects.layer, SetStoryStage.layer, VideoSets.layer, Sources.layer]))
