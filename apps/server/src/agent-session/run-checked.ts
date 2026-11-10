import { Effect, Schema } from "effect"
import type { StageContext } from "../runs/stages.ts"
import { AgentError, type AgentSession, type AgentTask, agentTool, type AgentTool } from "./agent-session.ts"

// The server's verdict on an agent's result: the (possibly corrected) value, and what's still wrong.
export interface Checked<A> {
  readonly value: A
  readonly problems: ReadonlyArray<string>
}

// What runChecked runs: an agent task whose first message is the brief.
export type CheckedTask<S extends Schema.Top> = Omit<AgentTask<S>, "message" | "resumeSession"> & { readonly brief: string }

// How many times the agent may fix a result the server rejected before the stage fails.
const FIX_ATTEMPTS = 2

// When the agent is offered `tell_creator` (Decision 10 of the redesign plan): on every turn, or only when it revises
// after your note. Kept on every turn while the evals show no drop in first-try passes.
export const TELL_CREATOR_ON: "all" | "revisions" = "all"

export const TELL_CREATOR = "tell_creator"

// The agent's own words for the short's chat: a few plain sentences about what it made or changed and why, stored on
// the stage run. The chat falls back to the server's change line when the agent doesn't call it.
export const tellCreatorTool = (output: string, record: (text: string) => Effect.Effect<void>): AgentTool =>
  agentTool({
    name: TELL_CREATOR,
    description: `Before calling ${output}, tell the creator in 1-3 plain sentences what you made or changed and why. ` +
      "Write to them directly, without jargon or tool names. Then call " + output + ".",
    schema: Schema.Struct({ text: Schema.String }),
    run: ({ text }) => record(text.trim()).pipe(Effect.as("Noted. Now call " + output + "."))
  })

const fixPrompt = (tool: string, problems: ReadonlyArray<string>) =>
  `That result has problems:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nFix them and call ${tool} again with the whole result.`

// Runs an agent stage's task inside a stage run: asks the agent, checks its result, and hands any problems
// back in the same conversation until the result passes or the fix attempts run out. A rejected attempt
// (`ctx.note`) resumes its previous conversation with your note. Cost and the session id land on the stage run.
export const runChecked = Effect.fn("runChecked")(function*<S extends Schema.Top, A>(
  agent: AgentSession["Service"],
  ctx: StageContext,
  task: CheckedTask<S>,
  check: (proposed: S["Type"]) => Effect.Effect<Checked<A>>
) {
  let session = ctx.resumeSession
  const fresh = ctx.note === null ? task.brief : `${task.brief}\n\nNote from the reviewer on the last version: ${ctx.note}`
  // a short's agents speak to you in its chat; a video's or a set's stages have no chat yet
  const tells = ctx.owner._tag === "Project" && (TELL_CREATOR_ON === "all" || ctx.note !== null)
  // a resumed conversation predates the tool, so the revision asks for it by name
  let message = ctx.note !== null && session !== null
    ? `Revise it: ${ctx.note}\n\n${tells ? `Tell the creator what you changed with ${TELL_CREATOR}, then call` : "Call"} ${task.output.tool} again with the whole result.`
    : fresh
  const tools = tells ? [...(task.tools ?? []), tellCreatorTool(task.output.tool, ctx.recordReply)] : task.tools ?? []
  const hooks = {
    progress: ctx.progress,
    recordCost: ctx.recordCost,
    recordSession: (id: string) => Effect.sync(() => void (session = id)).pipe(Effect.andThen(ctx.recordSession(id)))
  }

  for (let attempt = 0;; attempt++) {
    const resuming = attempt === 0 && session !== null && ctx.resumeSession !== null
    const proposed = yield* agent.run({ ...task, tools, message, resumeSession: session }, hooks).pipe(
      // an old conversation that can't be picked up any more (an expired session, a Codex thread or saved history
      // that's gone) starts afresh with the brief and your note
      Effect.catchIf(
        (error) => resuming && error._tag === "AgentError" && (error.code === "session" || error.code === "ended"),
        () => {
          session = null
          return agent.run({ ...task, tools, message: fresh, resumeSession: null }, hooks)
        }
      )
    )
    const checked = yield* check(proposed)
    if (checked.problems.length === 0) return checked.value
    if (attempt >= FIX_ATTEMPTS) {
      return yield* new AgentError({ code: "invalid-output", message: checked.problems.join("; ") })
    }
    yield* ctx.progress(null, `fixing: ${checked.problems.join("; ")}`)
    message = fixPrompt(task.output.tool, checked.problems)
  }
})
