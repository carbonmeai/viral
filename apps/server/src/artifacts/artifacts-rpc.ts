import { ArtifactsRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { Artifacts } from "./artifacts.ts"

export const ArtifactsRpcLive = ArtifactsRpcs.toLayer(Effect.gen(function*() {
  const artifacts = yield* Artifacts
  return ArtifactsRpcs.of({
    ListArtifacts: ({ owner }) => artifacts.list(owner)
  })
}))
