import { ProjectNotFound, RunsRpcs, SourceNotFound } from "@viral/contracts"
import { Effect } from "effect"
import { Projects } from "../projects/projects.ts"
import { Sources } from "../sources/sources.ts"
import { RunManager } from "./run-manager.ts"
import { RunStore } from "./run-store.ts"

export const RunsRpcLive = RunsRpcs.toLayer(Effect.gen(function*() {
  const runs = yield* RunManager
  const store = yield* RunStore
  const sources = yield* Sources
  const projects = yield* Projects
  return RunsRpcs.of({
    // A run that can't start (no such stage, not built yet) is a defect for the caller to see in the log.
    StartSourceRun: ({ sourceId }) =>
      sources.get(sourceId).pipe(
        Effect.flatMap(() => runs.start({ _tag: "Source", id: sourceId }, null).pipe(Effect.orDie)),
        Effect.catchTag("SourceNotFound", () => Effect.fail(new SourceNotFound({ id: sourceId })))
      ),
    StartProjectRun: ({ projectId, from }) =>
      projects.get(projectId).pipe(
        Effect.flatMap(() => runs.start({ _tag: "Project", id: projectId }, from).pipe(Effect.orDie)),
        Effect.catchTag("ProjectNotFound", () => Effect.fail(new ProjectNotFound({ id: projectId })))
      ),
    CancelRun: ({ runId }) => runs.cancel(runId),
    ResumeRun: ({ runId }) => runs.resume(runId).pipe(Effect.catchTag("StageFailure", Effect.die)),
    ListRuns: ({ owner }) => store.listRuns(owner),
    SubscribeRun: ({ runId, afterSeq }) => runs.subscribe(runId, afterSeq),
    ListPendingRequests: () => store.listPendingRequests,
    RespondToRequest: ({ requestId, response }) => runs.respond(requestId, response)
  })
}))
