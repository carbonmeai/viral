import { type JobEvent, PipelineRpcs } from "@viral/contracts"
import { Effect, Queue, Stream } from "effect"
import { Jobs } from "../jobs/jobs.ts"
import { Pipeline } from "./pipeline.ts"

export const PipelineRpcLive = PipelineRpcs.toLayer(Effect.gen(function*() {
  const jobs = yield* Jobs
  const pipeline = yield* Pipeline

  return PipelineRpcs.of({
    // The job runs in a fiber owned by this stream: a client disconnect or a
    // CancelJob from any other client interrupts it, and finalizers kill its processes.
    StartJob: ({ jobId, renderSeconds }) =>
      Stream.callback<JobEvent>((queue) =>
        Effect.gen(function*() {
          const emit = (event: JobEvent) => Queue.offer(queue, event).pipe(Effect.asVoid)
          const fiber = yield* pipeline.run(jobId, renderSeconds, emit).pipe(
            Effect.catch((error) => emit({ _tag: "Failed", message: error.message })),
            Effect.onInterrupt(() => emit({ _tag: "Cancelled" })),
            Effect.ensuring(Queue.end(queue)),
            Effect.forkScoped
          )
          yield* jobs.track(jobId, fiber)
        })
      )
  })
}))
