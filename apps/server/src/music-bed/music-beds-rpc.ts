import { MusicBedsRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { MusicBeds } from "./music-beds.ts"

export const MusicBedsRpcLive = MusicBedsRpcs.toLayer(Effect.gen(function*() {
  const beds = yield* MusicBeds
  return MusicBedsRpcs.of({
    GetMusicBed: ({ projectId }) => beds.get(projectId),
    RefitMusic: ({ projectId, trackId, dropWord }) => beds.refit(projectId, trackId, dropWord),
    ArrangeMusic: ({ projectId, arrangement }) => beds.arrange(projectId, arrangement),
    PreviewMusicArrangement: ({ projectId, arrangement }) => beds.preview(projectId, arrangement)
  })
}))
