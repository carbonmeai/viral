import { VideoSetsRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { VideoSetOverviews } from "./video-set-overview.ts"
import { VideoSets } from "./video-sets.ts"

export const VideoSetsRpcLive = VideoSetsRpcs.toLayer(Effect.gen(function*() {
  const sets = yield* VideoSets
  const overviews = yield* VideoSetOverviews
  return VideoSetsRpcs.of({
    CreateVideoSet: (input) => sets.create(input),
    ListVideoSets: () => sets.list,
    GetVideoSetOverview: ({ id }) => overviews.get(id),
    RenameVideoSet: ({ id, title }) => sets.rename(id, title),
    DeleteVideoSet: ({ id }) => sets.remove(id)
  })
}))
