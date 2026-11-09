import { PublishRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { Publishing } from "./publishing.ts"

export const PublishRpcLive = PublishRpcs.toLayer(Effect.gen(function*() {
  const publishing = yield* Publishing
  return PublishRpcs.of({
    GetPublishStatus: ({ projectId }) => publishing.status(projectId),
    SetPostText: ({ projectId, post }) => publishing.setPost(projectId, post),
    PublishAgain: ({ projectId }) => publishing.publishAgain(projectId)
  })
}))
