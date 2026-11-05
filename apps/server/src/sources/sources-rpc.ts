import { SourcesRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { Sources } from "./sources.ts"

export const SourcesRpcLive = SourcesRpcs.toLayer(Effect.gen(function*() {
  const sources = yield* Sources
  return SourcesRpcs.of({
    CreateSource: (input) => sources.create(input),
    ListSources: () => sources.list,
    GetSource: ({ id }) => sources.get(id),
    SetSourceRights: ({ id, rights, rightsNote }) => sources.setRights(id, rights, rightsNote),
    DeleteSource: ({ id }) => sources.remove(id)
  })
}))
