import { AgentError, type AgentHooks, type AgentTask } from "@viral/provider-core"
import { Effect, Schema } from "effect"

// Answers each job with a saved result instead of calling a model, so whole pipelines run in tests without
// spending tokens. The result still goes through the stage's schema.
export const replayRun = <Skill extends string>(answer: (task: AgentTask<Schema.Top, Skill>) => unknown) =>
  Effect.fn("replayRun")(function*<S extends Schema.Top>(task: AgentTask<S, Skill>, hooks: AgentHooks) {
    yield* hooks.recordSession(`replay-${task.stage}`)
    yield* hooks.recordCost({ model: "replay", inputTokens: 0, outputTokens: 0, costUsd: 0, provider: "replay", billing: null })
    return yield* Schema.decodeUnknownEffect(task.output.schema)(answer(task)).pipe(
      Effect.mapError((error) => new AgentError({ code: "invalid-output", message: error.message }))
    )
  })
