import { VideoSetsRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { Researches } from "../research/researches.ts"
import { RunManager } from "../runs/run-manager.ts"
import { RunStore } from "../runs/run-store.ts"
import { VideoSetOverviews } from "./video-set-overview.ts"
import { VideoSets } from "./video-sets.ts"

export const VideoSetsRpcLive = VideoSetsRpcs.toLayer(Effect.gen(function*() {
  const sets = yield* VideoSets
  const overviews = yield* VideoSetOverviews
  const researches = yield* Researches
  const runs = yield* RunManager
  const store = yield* RunStore
  return VideoSetsRpcs.of({
    CreateVideoSet: (input) => sets.create(input),
    ListVideoSets: () => sets.list,
    GetVideoSetOverview: ({ id }) => overviews.get(id),
    RenameVideoSet: ({ id, title }) => sets.rename(id, title),
    DeleteVideoSet: ({ id }) => sets.remove(id),
    // the set, then its run (the research) at once; a run that can't start is a defect for the log
    StartResearch: Effect.fn("StartResearch")(function*(research) {
      const set = yield* sets.createResearch(research)
      yield* runs.start({ _tag: "Set", id: set.id }, null).pipe(Effect.orDie)
      return set
    }),
    LookupShortlistVideo: ({ setId, link }) => researches.lookup(setId, link),
    CheckShortlistEdit: ({ setId, shortlist }) => Effect.map(researches.checkEdit(setId, shortlist), (problems) => ({ problems })),
    // a run still going on the set stops first, so the replacement starts clean
    ReplaceResearchVideo: Effect.fn("ReplaceResearchVideo")(function*({ setId, sourceId, backup, reason }) {
      const owner = { _tag: "Set", id: setId } as const
      const going = (yield* store.listRuns(owner)).filter((r) => r.status === "running" || r.status === "waiting")
      yield* Effect.forEach(going, (r) => runs.cancel(r.id), { discard: true })
      const next = yield* researches.replace(setId, sourceId, backup, reason ?? "")
      return yield* runs.start(owner, next.from).pipe(Effect.orDie)
    })
  })
}))
