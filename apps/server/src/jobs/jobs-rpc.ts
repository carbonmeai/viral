import { JobsRpcs } from "@viral/contracts"
import { Effect } from "effect"
import { Jobs } from "./jobs.ts"

export const JobsRpcLive = JobsRpcs.toLayer(Effect.gen(function*() {
  const jobs = yield* Jobs
  return JobsRpcs.of({
    Respond: ({ requestId, approved }) => jobs.respond(requestId, approved),
    CancelJob: ({ jobId }) => jobs.cancel(jobId)
  })
}))
