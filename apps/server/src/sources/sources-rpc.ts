import { SourcesRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { Sources } from "./sources.ts"
import { VideoLinks } from "./video-links.ts"

export const SourcesRpcLive = SourcesRpcs.toLayer(Effect.gen(function*() {
  const sources = yield* Sources
  const links = yield* VideoLinks
  return SourcesRpcs.of({
    CreateSource: (input) => sources.create(input),
    ListSources: () => sources.list,
    LookupVideoLink: ({ link }) => links.lookup(link),
    GetSource: ({ id }) => sources.get(id),
    SetSourceRights: ({ id, rights, rightsNote }) => sources.setRights(id, rights, rightsNote),
    SetSourceDetails: ({ id, title, channel }) => sources.setDetails(id, title, channel),
    DeleteSource: ({ id }) => sources.remove(id)
  })
}))
