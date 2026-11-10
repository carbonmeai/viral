import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { Deferred, Effect, Option, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
// @effect-diagnostics-next-line nodeBuiltinImport:off -- the MCP SDK's HTTP transport needs a node:http server
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { AgentError, type AgentTask, outputMismatch, toolShape } from "./agent-task.ts"

// The tool server a CLI connects to for one job: the stage's output tool and its helper tools over MCP
// (Streamable HTTP, no sessions), on 127.0.0.1 behind a random bearer token. Codex and OpenCode run Viral's tools
// this way (the Claude CLI takes them in-process).
export interface ToolEndpoint<A> {
  // http://127.0.0.1:<port>/mcp
  readonly url: string
  readonly token: string
  // the MCP server's name; a CLI shows its tools as `<name>_<tool>` or similar
  readonly name: string
  // completes when the output tool is called with input the stage's schema accepts
  readonly submitted: Deferred.Deferred<A>
  // the last input the output tool was called with, accepted or not (for an "invalid-output" error)
  readonly lastOutput: () => Option.Option<unknown>
}

export const TOOL_SERVER_NAME = "viral"

// The output tool's answer once its input is accepted: the run should stop here.
export const RECEIVED = "Received. Stop here."

const readBody = (req: IncomingMessage) =>
  new Promise<unknown>((resolve, reject) => {
    const chunks: Array<Buffer> = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8")
      try {
        resolve(text === "" ? undefined : JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on("error", reject)
  })

// Starts the endpoint for the length of the surrounding scope.
export const toolEndpoint = Effect.fn("toolEndpoint")(function*<S extends Schema.Top>(task: AgentTask<S>) {
  const random = yield* SecureRandom.SecureRandom
  const token = (yield* random.uuidV7()).replaceAll("-", "")
  const submitted = yield* Deferred.make<S["Type"]>()
  const services = yield* Effect.context<S["DecodingServices"]>()
  let last: Option.Option<unknown> = Option.none()
  const decode = Schema.decodeUnknownEffect(task.output.schema)

  // a fresh MCP server per request: the transport has no sessions, so each call stands alone
  const serverFor = () => {
    const server = new McpServer({ name: TOOL_SERVER_NAME, version: "1.0.0" })
    server.registerTool(task.output.tool, { description: task.output.description, inputSchema: toolShape(task.output.schema) }, async (args) => {
      last = Option.some(args)
      const text = await Effect.runPromiseWith(services)(decode(args).pipe(Effect.match({
        onFailure: (error) => outputMismatch(task.output.tool, error.message),
        onSuccess: (value) => {
          Deferred.doneUnsafe(submitted, Effect.succeed(value))
          return RECEIVED
        }
      })))
      return { content: [{ type: "text", text }] }
    })
    for (const helper of task.tools ?? []) {
      server.registerTool(helper.name, { description: helper.description, inputSchema: toolShape(helper.schema) }, async (args) => ({
        content: [{ type: "text", text: (await Effect.runPromiseWith(services)(helper.run(args))).text }]
      }))
    }
    return server
  }

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.headers.authorization !== `Bearer ${token}` || req.url?.split("?")[0] !== "/mcp") {
      res.writeHead(req.url?.split("?")[0] === "/mcp" ? 401 : 404).end()
      return
    }
    try {
      const body = req.method === "POST" ? await readBody(req) : undefined
      const server = serverFor()
      // no session id generator: stateless, each request stands alone
      const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true })
      res.on("close", () => {
        void transport.close()
        void server.close()
      })
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch (error) {
      if (!res.headersSent) res.writeHead(500).end(error instanceof Error ? error.message : String(error))
    }
  }

  const http = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: () =>
        new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
          const server = createServer((req, res) => void handle(req, res))
          server.once("error", reject)
          server.listen(0, "127.0.0.1", () => resolve(server))
        }),
      catch: (cause) => new AgentError({ code: "session", message: `couldn't start Viral's tool server: ${String(cause)}` })
    }),
    // close every connection too: a client's keep-alive socket would otherwise hold the server open
    (server) =>
      Effect.promise(() =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
          server.closeAllConnections()
        })
      )
  )
  const address = http.address()
  const port = typeof address === "object" && address !== null ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    name: TOOL_SERVER_NAME,
    submitted,
    lastOutput: () => last
  } satisfies ToolEndpoint<S["Type"]>
})
