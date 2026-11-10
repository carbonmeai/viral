import { AgentError, type AgentHooks, type AgentTask } from "@viral/provider-core"
import { Effect, Schema } from "effect"

// A saved answer that also calls helper tools first, as a model would: `reply` is said through `tell_creator` when
// the task offers it, then each of `calls` runs in order (a tool the task doesn't offer fails the run, so a test
// notices).
export class ReplayAnswer {
  readonly result: unknown
  readonly reply: string | null
  readonly calls: ReadonlyArray<{ readonly tool: string; readonly input: unknown }>
  constructor(result: unknown, reply: string | null = null, calls: ReadonlyArray<{ readonly tool: string; readonly input: unknown }> = []) {
    this.result = result
    this.reply = reply
    this.calls = calls
  }
}

export const replayAnswer = (spec: {
  readonly result: unknown
  readonly reply?: string
  readonly calls?: ReadonlyArray<{ readonly tool: string; readonly input: unknown }>
}) => new ReplayAnswer(spec.result, spec.reply ?? null, spec.calls ?? [])

// Answers each job with a saved result instead of calling a model, so whole pipelines run in tests without
// spending tokens. The result still goes through the stage's schema; a ReplayAnswer calls its helper tools first.
export const replayRun = <Skill extends string>(answer: (task: AgentTask<Schema.Top, Skill>) => unknown) =>
  Effect.fn("replayRun")(function*<S extends Schema.Top>(task: AgentTask<S, Skill>, hooks: AgentHooks) {
    yield* hooks.recordSession(`replay-${task.stage}`)
    yield* hooks.recordCost({ model: "replay", inputTokens: 0, outputTokens: 0, costUsd: 0, provider: "replay", billing: null })
    const given = answer(task)
    const saved = given instanceof ReplayAnswer ? given : new ReplayAnswer(given)
    const calls = [
      ...(saved.reply !== null && task.tools?.some((t) => t.name === "tell_creator") ? [{ tool: "tell_creator", input: { text: saved.reply } }] : []),
      ...saved.calls
    ]
    for (const call of calls) {
      const tool = task.tools?.find((t) => t.name === call.tool)
      if (tool === undefined) return yield* new AgentError({ code: "invalid-output", message: `the task offers no ${call.tool} tool` })
      yield* tool.run(call.input)
    }
    return yield* Schema.decodeUnknownEffect(task.output.schema)(saved.result).pipe(
      Effect.mapError((error) => new AgentError({ code: "invalid-output", message: error.message }))
    )
  })
