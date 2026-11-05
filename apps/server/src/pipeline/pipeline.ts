import type { JobEvent } from "@viral/contracts"
import { Context, Effect, Layer } from "effect"
import { Jobs } from "../jobs/jobs.ts"
import { type RenderError, RenderEngine } from "../render/render-engine.ts"
import { type AgentError, ScriptAgent } from "../script/script-agent.ts"
import { SAMPLE_TRANSCRIPT } from "./sample-transcript.ts"

type Emit = (event: JobEvent) => Effect.Effect<void>

// Pipeline: script agent -> human approval gate -> render job.
export class Pipeline extends Context.Service<Pipeline, {
  run(jobId: string, renderSeconds: number, emit: Emit): Effect.Effect<void, AgentError | RenderError>
}>()("@viral/server/pipeline/pipeline") {
  static readonly layer = Layer.effect(
    Pipeline,
    Effect.gen(function*() {
      const jobs = yield* Jobs
      const agent = yield* ScriptAgent
      const render = yield* RenderEngine

      const run = Effect.fn("Pipeline.run")(function*(jobId: string, renderSeconds: number, emit: Emit) {
        yield* emit({ _tag: "StageStarted", stage: "script" })
        const script = yield* agent.writeScript(SAMPLE_TRANSCRIPT, emit)
        yield* emit({ _tag: "ScriptProposed", script })

        const requestId = `${jobId}:script`
        yield* emit({ _tag: "ApprovalRequested", requestId, title: "Approve script?" })
        if (!(yield* jobs.awaitApproval(requestId))) {
          return yield* emit({ _tag: "Rejected" })
        }

        yield* emit({ _tag: "StageStarted", stage: "render" })
        const output = yield* render.renderProbe(renderSeconds, emit)
        yield* emit({ _tag: "Completed", output })
      })

      return Pipeline.of({ run })
    })
  )
}
