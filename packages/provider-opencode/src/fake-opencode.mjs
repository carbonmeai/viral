// A stand-in for `opencode` in the provider's tests: `--version` and a scripted `serve` that answers the SDK's
// session calls and streams its events. The user message is the script:
// {"calls":[{"tool","args"}],"end":"wait"|"complete"|"error"}. The calls go to Viral's MCP endpoint from
// OPENCODE_CONFIG_CONTENT, like OpenCode makes them. The launch and each tool result are appended to
// $FAKE_OPENCODE_LOG as JSON lines.
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { appendFileSync } from "node:fs"
import { createServer } from "node:http"

const args = process.argv.slice(2)
const log = (entry) => process.env.FAKE_OPENCODE_LOG && appendFileSync(process.env.FAKE_OPENCODE_LOG, `${JSON.stringify(entry)}\n`)

if (args[0] === "--version") {
  process.stdout.write(`${process.env.FAKE_OPENCODE_VERSION ?? "1.14.19"}\n`)
  process.exit(0)
}

if (args[0] === "auth") {
  process.stdout.write(`\u001b[0m\n┌  Credentials ~/.local/share/opencode/auth.json\n│\n└  ${process.env.FAKE_OPENCODE_CREDENTIALS ?? "1"} credentials\n`)
  process.exit(0)
}
if (args[0] === "models") {
  process.stdout.write("opencode/big-pickle\nanthropic/claude-haiku-5.5\n")
  process.exit(0)
}

const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "{}")
const port = Number(args.find((arg) => arg.startsWith("--port="))?.slice(7))
const auth = `Basic ${Buffer.from(`opencode:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`
log({ argv: args, config, env: { claude: process.env.OPENCODE_DISABLE_CLAUDE_CODE } })

const sessions = new Map()
const subscribers = new Set()
const emit = (type, properties) => {
  for (const res of subscribers) res.write(`data: ${JSON.stringify({ id: String(Math.random()), type, properties })}\n\n`)
}
let aborted = null
let abortRequested = false

const assistant = (sessionID, id, extra = {}) => ({
  id, sessionID, role: "assistant", parentID: "u", modelID: "big", providerID: "zen", mode: "viral", agent: "viral",
  path: { cwd: "/", root: "/" }, time: { created: 1 }, cost: 0.002,
  tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 50, write: 0 } }, ...extra
})
const messagesOf = (sessionID) => {
  // a session Viral resumes already has an earlier answer, which this turn mustn't count
  if (!sessions.has(sessionID)) sessions.set(sessionID, [{ info: assistant(sessionID, "old", { cost: 1 }), parts: [] }])
  return sessions.get(sessionID)
}

const readBody = (req) => new Promise((resolve) => {
  let text = ""
  req.on("data", (chunk) => (text += chunk))
  req.on("end", () => resolve(text === "" ? {} : JSON.parse(text)))
})
const json = (res, body) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body))

const prompt = async (sessionID, body, res) => {
  const script = JSON.parse(body.parts[0].text)
  log({ prompt: { agent: body.agent, model: body.model } })
  const messages = messagesOf(sessionID)
  const viral = config.mcp.viral
  const client = new Client({ name: "fake-opencode", version: "1.0.0" })
  await client.connect(new StreamableHTTPClientTransport(new URL(viral.url), { requestInit: { headers: viral.headers } }))
  emit("message.part.updated", { sessionID, time: 1, part: { id: "t1", sessionID, messageID: "a1", type: "text", text: "Looking at it.", time: { start: 1, end: 2 } } })
  for (const [i, call] of script.calls.entries()) {
    messages.push({ info: assistant(sessionID, `a${i}`), parts: [] })
    emit("message.part.updated", { sessionID, time: 1, part: { id: `p${i}`, sessionID, messageID: `a${i}`, type: "tool", callID: `c${i}`, tool: `viral_${call.tool}`, state: { status: "running" } } })
    const result = await client.callTool({ name: call.tool, arguments: call.args })
    log({ tool: call.tool, result: result.content?.[0]?.text })
  }
  await client.close()
  const last = assistant(sessionID, "final")
  if (script.end === "wait") {
    aborted = () => {
      messages.push({ info: { ...last, error: { name: "MessageAbortedError", data: { message: "aborted" } } }, parts: [] })
      emit("session.error", { sessionID, error: { name: "MessageAbortedError", data: { message: "aborted" } } })
      json(res, { info: last, parts: [] })
    }
    if (abortRequested) aborted()
  } else if (script.end === "error") {
    // like an out-of-credit provider: the error comes as an event and the prompt call never answers
    messages.push({ info: { ...last, error: { name: "APIError", data: { message: "Free usage limit reached", isRetryable: false } } }, parts: [] })
    emit("session.error", { sessionID, error: { name: "APIError", data: { message: "Free usage limit reached", isRetryable: false } } })
  } else {
    messages.push({ info: last, parts: [] })
    json(res, { info: last, parts: [] })
  }
}

const server = createServer(async (req, res) => {
  if (req.headers.authorization !== auth) return res.writeHead(401).end()
  const url = new URL(req.url, "http://x")
  const parts = url.pathname.split("/").filter(Boolean)
  if (url.pathname === "/event") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
    res.write(`data: ${JSON.stringify({ id: "0", type: "server.connected", properties: {} })}\n\n`)
    subscribers.add(res)
    return req.on("close", () => subscribers.delete(res))
  }
  if (req.method === "POST" && url.pathname === "/session") {
    const body = await readBody(req)
    sessions.set("ses_1", [])
    log({ create: body })
    return json(res, { id: "ses_1", title: body.title, version: "1", time: { created: 1, updated: 1 }, projectID: "p", directory: "/" })
  }
  if (parts[0] === "session" && parts[2] === "message") {
    if (req.method === "GET") return json(res, messagesOf(parts[1]))
    return prompt(parts[1], await readBody(req), res)
  }
  if (parts[0] === "session" && parts[2] === "abort") {
    log({ abort: parts[1] })
    json(res, true)
    abortRequested = true
    return aborted?.()
  }
  res.writeHead(404).end()
})
server.listen(port, "127.0.0.1", () => process.stdout.write(`opencode server listening on http://127.0.0.1:${port}\n`))
