import { SourceOverviewRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { SourceOverviews } from "./source-overview.ts"

export const SourceOverviewRpcLive = SourceOverviewRpcs.toLayer(Effect.gen(function*() {
  const overviews = yield* SourceOverviews
  return SourceOverviewRpcs.of({
    GetSourceOverview: ({ sourceId }) => overviews.get(sourceId)
  })
}))
