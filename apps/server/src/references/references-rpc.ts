import { ReferencesRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { References } from "./references.ts"

export const ReferencesRpcLive = ReferencesRpcs.toLayer(Effect.gen(function*() {
  const references = yield* References
  return ReferencesRpcs.of({
    CreateReferenceVideo: ({ url, notes }) => references.create(url, notes),
    ListReferenceVideos: () => references.list,
    GetReferenceVideo: ({ id }) => references.get(id),
    DeleteReferenceVideo: ({ id }) => references.remove(id)
  })
}))
