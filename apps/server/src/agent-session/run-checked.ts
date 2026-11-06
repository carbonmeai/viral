import { Effect, type Schema } from "effect"
import type { StageContext } from "../runs/stages.ts"
import { AgentError, type AgentSession, type AgentTask } from "./agent-session.ts"

// The server's verdict on an agent's result: the (possibly corrected) value, and what's still wrong.
export interface Checked<A> {
  readonly value: A
  readonly problems: ReadonlyArray<string>
}

// How many times the agent may fix a result the server rejected before the stage fails.
const FIX_ATTEMPTS = 2

const fixPrompt = (tool: string, problems: ReadonlyArray<string>) =>
  `That result has problems:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nFix them and call ${tool} again with the whole result.`

// Runs an agent stage's task inside a stage run: asks the agent, checks its result, and hands any problems
// back in the same conversation until the result passes or the fix attempts run out. A rejected attempt
// (`ctx.note`) resumes its previous conversation with your note. Cost and the session id land on the stage run.
export const runChecked = Effect.fn("runChecked")(function*<S extends Schema.Top, A>(
  agent: AgentSession["Service"],
  ctx: StageContext,
  task: Omit<AgentTask<S>, "message" | "resumeSession"> & { readonly brief: string },
  check: (proposed: S["Type"]) => Effect.Effect<Checked<A>>
) {
  let session = ctx.resumeSession
  let message = ctx.note !== null && session !== null
    ? `Revise it: ${ctx.note}\n\nCall ${task.output.tool} again with the whole result.`
    : ctx.note === null
    ? task.brief
    : `${task.brief}\n\nNote from the reviewer on the last version: ${ctx.note}`

  for (let attempt = 0;; attempt++) {
    const proposed = yield* agent.run({ ...task, message, resumeSession: session }, {
      progress: ctx.progress,
      recordCost: (cost) => ctx.recordCost(cost),
      recordSession: (id) => Effect.sync(() => void (session = id)).pipe(Effect.andThen(ctx.recordSession(id)))
    })
    const checked = yield* check(proposed)
    if (checked.problems.length === 0) return checked.value
    if (attempt >= FIX_ATTEMPTS) {
      return yield* new AgentError({ code: "invalid-output", message: checked.problems.join("; ") })
    }
    yield* ctx.progress(null, `fixing: ${checked.problems.join("; ")}`)
    message = fixPrompt(task.output.tool, checked.problems)
  }
})
