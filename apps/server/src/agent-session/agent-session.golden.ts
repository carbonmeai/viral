// Live check against your Claude CLI (Haiku, about a cent): structured output, cost and session recording,
// the read sandbox, and resuming a conversation. Run with `bun run test:golden`.
import { Effect, Schema } from "effect"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { AgentSession, type AgentHooks, type AgentTask } from "./agent-session.ts"

let work: string
before(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "viral-agent-")))
  process.env.VIRAL_HOME = join(work, "home")
  mkdirSync(join(work, "allowed"))
  writeFileSync(join(work, "allowed", "inside.txt"), "The fruit is kiwi.\n")
  writeFileSync(join(work, "outside.txt"), "The fruit is mango.\n")
})
after(() => rmSync(work, { recursive: true, force: true }))

const Fruits = Schema.Struct({
  inside: Schema.String,
  // what happened when reading the outside file
  outside: Schema.String
})

const recorder = () => {
  const seen = { sessions: [] as Array<string>, costs: [] as Array<number>, messages: [] as Array<string> }
  const hooks: AgentHooks = {
    progress: (_, message) => Effect.sync(() => void (message && seen.messages.push(message))),
    recordCost: (cost) => Effect.sync(() => void seen.costs.push(cost.costUsd)),
    recordSession: (id) => Effect.sync(() => void seen.sessions.push(id))
  }
  return { seen, hooks }
}

const fruitTask = (): AgentTask<typeof Fruits> => ({
  stage: "test",
  instructions: "You read files when asked and report exactly what you found.",
  skills: [],
  message: `Read ${join(work, "allowed", "inside.txt")} and ${join(work, "outside.txt")}. Report the fruit from the first
file in "inside" and, in "outside", the fruit from the second file or the word DENIED if you couldn't read it.
Then call propose_fruits.`,
  output: { tool: "propose_fruits", description: "Report what the two files say.", schema: Fruits },
  defaultModel: "haiku",
  readDirs: [join(work, "allowed")],
  maxTurns: 6
})

test("an isolated session returns structured output, records cost, and can only read its folders", { timeout: 180_000 }, async () => {
  const { seen, hooks } = recorder()
  const result = await Effect.runPromise(
    AgentSession.use((s) => s.run(fruitTask(), hooks)).pipe(Effect.provide(AgentSession.layer))
  )
  console.log(JSON.stringify({ result, costs: seen.costs }))
  assert.match(result.inside.toLowerCase(), /kiwi/)
  assert.doesNotMatch(result.outside.toLowerCase(), /mango/, "the file outside the stage's folder stays unreadable")
  assert.equal(seen.sessions.length, 1)
  assert.ok(seen.costs[0]! > 0, "cost is recorded")

  // resuming the same session keeps the conversation
  const Recall = Schema.Struct({ fruit: Schema.String })
  const recall = await Effect.runPromise(
    AgentSession.use((s) =>
      s.run({
        stage: "test",
        instructions: "Answer from the conversation so far.",
        skills: [],
        message: "Which fruit did the readable file name? Call propose_recall, without reading anything again.",
        output: { tool: "propose_recall", description: "Report the fruit.", schema: Recall },
        defaultModel: "haiku",
        resumeSession: seen.sessions[0]!,
        maxTurns: 3
      }, recorder().hooks)
    ).pipe(Effect.provide(AgentSession.layer))
  )
  assert.match(recall.fruit.toLowerCase(), /kiwi/)
})
