// A stand-in for OpenCode 2 (`opencode`) in the provider's tests: `--version`, `auth list --format json`, `models`
// and a scripted `serve` that answers the `/api` session calls and streams its events like OpenCode 2. The prompt
// text is the script: {"calls":[{"tool","args"}],"end":"wait"|"complete"|"error"|"retry"}. The calls go to Viral's
// MCP endpoint from OPENCODE_CONFIG_CONTENT, like OpenCode makes them; each is a step that costs $0.002. The launch,
// the session calls and each tool result are appended to $FAKE_OPENCODE_LOG as JSON lines.
// FAKE_OPENCODE_AUTH: "console" (default: signed in to the OpenCode Console), "none" (nothing stored) or "key" (an
// API key in the environment for another provider, whose models are listed too).
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { appendFileSync } from "node:fs"
import { createServer } from "node:http"

const args = process.argv.slice(2)
const log = (entry) => process.env.FAKE_OPENCODE_LOG && appendFileSync(process.env.FAKE_OPENCODE_LOG, `${JSON.stringify(entry)}\n`)
const auth = process.env.FAKE_OPENCODE_AUTH ?? "console"

if (args[0] === "--version") {
  process.stdout.write(`opencode v${process.env.FAKE_OPENCODE_VERSION ?? "2.2.6"}\n`)
  process.exit(0)
}

if (args[0] === "auth") {
  log({ argv: args })
  const integrations = [
    { id: "opencode", name: "OpenCode Console", connections: auth === "console" ? [{ type: "credential", id: "cred_1", label: "Default", method: "oauth" }] : [] },
    ...(auth === "key" ? [{ id: "vercel", name: "Vercel AI Gateway", connections: [{ type: "env", name: "AI_GATEWAY_API_KEY" }] }] : [])
  ]
  process.stdout.write(`${JSON.stringify(integrations, null, 2)}\n`)
  process.exit(0)
}
if (args[0] === "models") {
  log({ argv: args })
  process.stdout.write(`opencode/claude-haiku-5-5\nopencode/big-pickle\n${auth === "key" ? "vercel/anthropic/claude-haiku-5.5\n" : ""}`)
  process.exit(0)
}

const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}")
const port = Number(args.find((arg) => arg.startsWith("--port="))?.slice(7))
const basic = `Basic ${Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`
log({ argv: args, config, env: { claude: process.env.OPENCODE_DISABLE_CLAUDE_CODE } })

const subscribers = new Set()
let seq = 0
const emit = (type, data) => {
  for (const res of subscribers) res.write(`data: ${JSON.stringify({ id: `evt_${seq++}`, type, data })}\n\n`)
}

// each session's running totals; a session Viral resumes already has an earlier answer, which this turn mustn't count
const sessions = new Map([["ses_9", { cost: 1, tokens: { input: 1000, output: 100, reasoning: 0, cache: { read: 0, write: 0 } } }]])
const zero = () => ({ cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } })
const info = (id) => ({ id, projectID: "p", agent: "viral", model: { id: "big", providerID: "zen", variant: "default" }, time: { created: 1, updated: 1 }, location: { directory: "/" }, ...sessions.get(id) })
const step = (sessionID) => {
  const totals = sessions.get(sessionID)
  totals.cost += 0.002
  totals.tokens.input += 100
  totals.tokens.output += 20
  totals.tokens.reasoning += 5
  totals.tokens.cache.read += 50
  emit("session.step.ended", { sessionID, assistantMessageID: "msg_1", finish: "tool-calls", cost: 0.002 })
}
let interrupted = null

const readBody = (req) => new Promise((resolve) => {
  let text = ""
  req.on("data", (chunk) => (text += chunk))
  req.on("end", () => resolve(text === "" ? {} : JSON.parse(text)))
})
const json = (res, body) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body))

const run = async (sessionID, text) => {
  const script = JSON.parse(text)
  const viral = config.mcp.servers.viral
  const client = new Client({ name: "fake-opencode", version: "1.0.0" })
  await client.connect(new StreamableHTTPClientTransport(new URL(viral.url), { requestInit: { headers: viral.headers } }))
  emit("session.execution.started", { sessionID })
  emit("session.text.ended", { sessionID, assistantMessageID: "msg_1", ordinal: 0, text: "Looking at it." })
  for (const [i, call] of script.calls.entries()) {
    emit("session.tool.input.started", { sessionID, assistantMessageID: "msg_1", id: `call_${i}`, name: `viral_${call.tool}` })
    const result = await client.callTool({ name: call.tool, arguments: call.args })
    log({ tool: call.tool, result: result.content?.[0]?.text })
    // the step that made the call ends a moment later: Viral waits for it before interrupting
    await new Promise((resolve) => setTimeout(resolve, 50))
    log({ stepEnded: i })
    step(sessionID)
  }
  await client.close()
  if (script.end === "wait") {
    // the model would go on; only an interrupt ends the turn
    interrupted = () => emit("session.execution.interrupted", { sessionID, reason: "user" })
  } else if (script.end === "error") {
    emit("session.execution.failed", { sessionID, error: { type: "api", message: "Insufficient balance", status: 402 } })
  } else if (script.end === "retry") {
    // a provider refusing for good: OpenCode would retry it, reporting it only as a scheduled retry
    emit("session.retry.scheduled", { sessionID, assistantMessageID: "msg_2", attempt: 1, at: 2, error: { type: "api", message: "Your free usage is over", status: 402 } })
  } else {
    emit("session.execution.succeeded", { sessionID })
  }
}

const server = createServer(async (req, res) => {
  if (req.headers.authorization !== basic) return res.writeHead(401).end()
  const url = new URL(req.url, "http://x")
  const parts = url.pathname.split("/").filter(Boolean)
  if (url.pathname === "/api/event") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
    res.write(`data: ${JSON.stringify({ id: "evt_c", type: "server.connected", data: {} })}\n\n`)
    subscribers.add(res)
    return req.on("close", () => subscribers.delete(res))
  }
  if (req.method === "POST" && url.pathname === "/api/session") {
    const body = await readBody(req)
    sessions.set("ses_1", zero())
    log({ create: body })
    return json(res, { data: info("ses_1") })
  }
  if (parts[0] !== "api" || parts[1] !== "session" || !sessions.has(parts[2])) return res.writeHead(404).end()
  const [sessionID, action] = [parts[2], parts[3]]
  if (req.method === "GET" && action === undefined) return json(res, { data: info(sessionID) })
  if (req.method === "POST" && ["move", "agent", "model"].includes(action)) {
    log({ [action]: await readBody(req) })
    return res.writeHead(204).end()
  }
  if (req.method === "POST" && action === "prompt") {
    const body = await readBody(req)
    log({ prompt: body })
    json(res, { data: { id: "msg_u", sessionID, time: { created: 1 }, type: "user", payload: { text: body.text }, delivery: "steer" } })
    return void run(sessionID, body.text)
  }
  if (req.method === "POST" && action === "interrupt") {
    log({ interrupt: sessionID })
    json(res, { interrupted: interrupted !== null })
    return interrupted?.()
  }
  res.writeHead(404).end()
})
server.listen(port, "127.0.0.1", () => process.stdout.write(`Server listening on http://127.0.0.1:${port}\n`))
