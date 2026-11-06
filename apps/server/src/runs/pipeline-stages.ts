import type { RunOwner } from "@viral/contracts"
import { Effect, Layer } from "effect"
import { SourceStages } from "../sources/source-stages.ts"
import { StageFailure, StageRegistry } from "./stages.ts"

// The real stage lists. A source run is source → transcribe → contact-sheet (ads and story join them next);
// a short's stages follow its approach once they exist.
export const PipelineStagesLive = Layer.effect(StageRegistry, Effect.gen(function*() {
  const source = yield* SourceStages
  const stagesFor = Effect.fn("StageRegistry.stagesFor")(function*(owner: RunOwner) {
    if (owner._tag === "Source") return source.stages
    return yield* new StageFailure({ stage: "script", code: "not-built", message: "short runs aren't built yet" })
  })
  return StageRegistry.of({ stagesFor })
})).pipe(Layer.provide(SourceStages.layer))
