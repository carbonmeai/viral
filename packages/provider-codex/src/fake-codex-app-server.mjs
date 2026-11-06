// A stand-in for `codex` in the provider's tests: `mcp list --json` and a scripted `app-server` that speaks the
// same JSON-RPC lines. The user message is the script: {"calls":[{"tool","args"}],"end":"wait"|"complete"|"fail"}.
// The calls go to Viral's MCP endpoint from the thread's config, like Codex makes them. Every request (and the
// launch arguments) is appended to $FAKE_CODEX_LOG as JSON lines for the tests to check.
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { appendFileSync } from "node:fs"
import { createInterface } from "node:readline"

const args = process.argv.slice(2)
const log = (entry) => process.env.FAKE_CODEX_LOG && appendFileSync(process.env.FAKE_CODEX_LOG, `${JSON.stringify(entry)}\n`)

if (args[0] === "--version") {
  process.stdout.write("codex-cli 0.154.0\n")
  process.exit(0)
}
if (args[0] === "mcp") {
  process.stdout.write(JSON.stringify([{ name: "mine", enabled: true }, { name: "plugin-one", enabled: true }]))
  process.exit(0)
}
log({ argv: args, cwd: process.cwd() })

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const notify = (method, params) => send({ method, params })
let server = null
let interrupted = null

const usage = (input, output) => ({ totalTokens: input + output, inputTokens: input, cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: output, reasoningOutputTokens: 0 })

const runTurn = async (threadId, turnId, script) => {
  // a resumed thread already used 1000 input tokens before this turn
  notify("thread/tokenUsage/updated", { threadId, turnId, tokenUsage: { total: usage(1100, 20), last: usage(100, 20), modelContextWindow: null } })
  notify("item/completed", { threadId, turnId, item: { type: "agentMessage", id: "m1", text: "Looking at it." } })
  const client = new Client({ name: "fake-codex", version: "1.0.0" })
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.http_headers } }))
  for (const call of script.calls) {
    notify("item/started", { threadId, turnId, item: { type: "mcpToolCall", id: call.tool, server: "viral", tool: call.tool } })
    const result = await client.callTool({ name: call.tool, arguments: call.args })
    log({ tool: call.tool, result: result.content?.[0]?.text })
  }
  await client.close()
  notify("thread/tokenUsage/updated", { threadId, turnId, tokenUsage: { total: usage(1300, 50), last: usage(200, 30), modelContextWindow: null } })
  const complete = (status, error = null) => notify("turn/completed", { threadId, turn: { id: turnId, items: [], status, error } })
  if (script.end === "wait") interrupted = () => complete("interrupted")
  else if (script.end === "fail") complete("failed", { message: "usage limit reached" })
  else complete("completed")
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line)
  log({ request: message })
  const reply = (result) => send({ id: message.id, result })
  switch (message.method) {
    case "initialize":
      return reply({ userAgent: "fake", codexHome: "/tmp", platformFamily: "unix", platformOs: "macos" })
    case "account/read":
      return reply({
        account: process.env.FAKE_CODEX_SIGNED_OUT ? null : { type: "chatgpt", email: "me@example.com", planType: "plus" },
        requiresOpenaiAuth: true
      })
    case "model/list":
      return reply({
        data: [
          { id: "gpt-big", displayName: "Big", hidden: false, isDefault: true, defaultReasoningEffort: "medium", inputModalities: ["text", "image"] },
          { id: "gpt-small", displayName: "Small", hidden: false, isDefault: false, defaultReasoningEffort: "low", inputModalities: ["text"] }
        ],
        nextCursor: null
      })
    case "thread/start":
    case "thread/resume":
      server = message.params.config["mcp_servers.viral"]
      return reply({ thread: { id: message.params.threadId ?? "thread-1" } })
    case "turn/start":
      reply({ turn: { id: "turn-1" } })
      return void runTurn(message.params.threadId, "turn-1", JSON.parse(message.params.input[0].text))
    case "turn/interrupt":
      reply({})
      return interrupted?.()
    default:
      return message.id === undefined ? undefined : send({ id: message.id, error: { code: -32601, message: "unknown" } })
  }
})
