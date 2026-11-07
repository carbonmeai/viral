import { type AgentCost, type AgentHooks, type AgentRun, type AgentTask, agentTool } from "@viral/provider-core"
import { Clock, Effect, Schema } from "effect"

// The job every provider's live check (`*.live.ts`, `bun run test:live`) runs on the real CLI: a tiny sum that needs
// one helper tool call (the secret number is only known to the tool) and one output tool call. A right answer
// proves the tools reach the model and the result comes back through the schema.
export const SECRET = 37
const Answer = Schema.Struct({ answer: Schema.Int })

export const liveTask: AgentTask<typeof Answer> = {
  stage: "live-check",
  instructions: "You answer arithmetic questions using your tools. Be brief.",
  skills: [],
  message: "Call secret_number with the name \"kiwi\" to get the secret number, add 5 to it, then call propose_answer with the sum.",
  output: { tool: "propose_answer", description: "Submit the final answer.", schema: Answer },
  defaultModel: null,
  tools: [agentTool({
    name: "secret_number",
    description: "Returns the secret number with the given name.",
    schema: Schema.Struct({ name: Schema.String }),
    run: () => Effect.succeed(String(SECRET))
  })],
  maxTurns: 6
}

// Runs the live task on `run` and keeps everything the hooks saw.
export const runLiveTask = Effect.fn("runLiveTask")(function*<R>(provider: Effect.Effect<AgentRun, never, R>, model: string | null) {
  const seen = { costs: [] as Array<AgentCost>, sessions: [] as Array<string>, progress: [] as Array<string> }
  const hooks: AgentHooks = {
    progress: (_pct, message) => Effect.sync(() => void (message && seen.progress.push(message))),
    recordCost: (cost) => Effect.sync(() => void seen.costs.push(cost)),
    recordSession: (id) => Effect.sync(() => void seen.sessions.push(id))
  }
  const run = yield* provider
  const started = yield* Clock.currentTimeMillis
  const result = yield* run(liveTask, hooks, model, liveTask.instructions)
  return { result, ...seen, seconds: ((yield* Clock.currentTimeMillis) - started) / 1000 }
})
