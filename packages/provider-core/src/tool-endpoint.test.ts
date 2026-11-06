import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Deferred, Effect, Option, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import assert from "node:assert/strict"
import { test } from "node:test"
import { type AgentTask, agentTool } from "./agent-task.ts"
import { RECEIVED, toolEndpoint } from "./tool-endpoint.ts"

const Answer = Schema.Struct({ answer: Schema.Int })
const task: AgentTask<typeof Answer> = {
  stage: "test",
  instructions: "Answer.",
  skills: [],
  message: "What is 6 × 7?",
  output: { tool: "propose_answer", description: "Submit the answer.", schema: Answer },
  defaultModel: null,
  tools: [agentTool({
    name: "look_closer",
    description: "Look closer.",
    schema: Schema.Struct({ at: Schema.Finite }),
    run: ({ at }) => Effect.succeed(`nothing new at ${at}`)
  })]
}

const connect = async (url: string, token: string) => {
  const client = new Client({ name: "test", version: "1.0.0" })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return client
}
const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as Array<{ readonly type: string; readonly text?: string }>).map((c) => c.text ?? "").join("")

test("the tool endpoint serves the output and helper tools, hands mismatches back, and resolves on a valid result", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const endpoint = yield* toolEndpoint(task)
    const client = yield* Effect.promise(() => connect(endpoint.url, endpoint.token))

    const tools = yield* Effect.promise(() => client.listTools())
    assert.deepEqual(tools.tools.map((t) => t.name).sort(), ["look_closer", "propose_answer"])
    assert.equal(yield* Effect.promise(() => client.callTool({ name: "look_closer", arguments: { at: 3 } }).then(text)), "nothing new at 3")

    const bad = yield* Effect.promise(() => client.callTool({ name: "propose_answer", arguments: { answer: 4.5 } }).then(text))
    // the SDK checks the tool's shape first; either way the model gets the reason back to fix it
    assert.match(bad, /Invalid arguments|doesn't match the expected format/)
    assert.equal(Option.isNone(yield* Deferred.poll(endpoint.submitted)), true, "a mismatch isn't a result")

    assert.equal(yield* Effect.promise(() => client.callTool({ name: "propose_answer", arguments: { answer: 42 } }).then(text)), RECEIVED)
    assert.deepEqual(yield* Deferred.await(endpoint.submitted), { answer: 42 })
    yield* Effect.promise(() => client.close())

    // the token is required
    const denied = yield* Effect.promise(() => fetch(endpoint.url, { method: "POST", body: "{}" }))
    assert.equal(denied.status, 401)
  })).pipe(Effect.provide(SecureRandom.layerWebCrypto)))
})
