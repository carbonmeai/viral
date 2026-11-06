import { Effect, Schema } from "effect"
import assert from "node:assert/strict"
import { test } from "node:test"
import { AgentSession, type AgentTask, toolShape } from "./agent-session.ts"

const Answer = Schema.Struct({ answer: Schema.Int, why: Schema.optionalKey(Schema.String) })

const task: AgentTask<typeof Answer> = {
  stage: "test",
  instructions: "Answer.",
  skills: [],
  message: "What is 6 × 7?",
  output: { tool: "propose_answer", description: "Submit the answer.", schema: Answer },
  defaultModel: null
}

const hooks = { progress: () => Effect.void, recordCost: () => Effect.void, recordSession: () => Effect.void }

test("the tool's input schema comes from the Effect Schema", () => {
  const shape = toolShape(Answer)
  assert.deepEqual(Object.keys(shape).sort(), ["answer", "why"])
  assert.equal(shape.answer!.safeParse(42).success, true)
  assert.equal(shape.answer!.safeParse("42").success, false)
  assert.equal(shape.why!.safeParse(undefined).success, true, "optional fields stay optional")
})

test("replay answers through the stage's schema", async () => {
  const ok = await Effect.runPromise(
    AgentSession.use((s) => s.run(task, hooks)).pipe(Effect.provide(AgentSession.replay(() => ({ answer: 42 }))))
  )
  assert.deepEqual(ok, { answer: 42 })

  const bad = await Effect.runPromiseExit(
    AgentSession.use((s) => s.run(task, hooks)).pipe(Effect.provide(AgentSession.replay(() => ({ answer: "lots" }))))
  )
  assert.match(JSON.stringify(bad), /invalid-output/)
})
