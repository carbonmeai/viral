import { Duration, Effect, Option, Schema, Stream } from "effect"
import { Sse } from "effect/encoding"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { AgentError } from "@viral/provider-core"

// The parts of OpenCode 2's server API (`/api/...`, its OpenAPI document at /openapi.json) that Viral uses. There
// is no published v2 SDK, so this is the client, wrapped once: every call fails as an AgentError carrying
// OpenCode's own explanation.

const CALL_TIMEOUT = Duration.seconds(30)

export const ModelRef = Schema.Struct({ providerID: Schema.String, id: Schema.String })
export type ModelRef = typeof ModelRef.Type

const Tokens = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  reasoning: Schema.Finite,
  cache: Schema.Struct({ read: Schema.Finite, write: Schema.Finite })
})

// a session's running totals: what every answer in it has cost so far
export const SessionInfo = Schema.Struct({
  id: Schema.String,
  cost: Schema.Finite,
  tokens: Tokens,
  model: Schema.optionalKey(ModelRef)
})
export type SessionInfo = typeof SessionInfo.Type

const Data = <S extends Schema.Top>(schema: S) => Schema.Struct({ data: schema })

const ErrorInfo = Schema.Struct({ type: Schema.String, message: Schema.String, status: Schema.optionalKey(Schema.Finite) })
const Session = { sessionID: Schema.String }

// The events Viral follows; the server sends many more, which are skipped.
export const OpencodeEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("server.connected") }),
  Schema.Struct({ type: Schema.Literal("session.text.ended"), data: Schema.Struct({ ...Session, text: Schema.String }) }),
  Schema.Struct({ type: Schema.Literal("session.tool.input.started"), data: Schema.Struct({ ...Session, id: Schema.String, name: Schema.String }) }),
  Schema.Struct({ type: Schema.Literal("session.step.ended"), data: Schema.Struct(Session) }),
  Schema.Struct({ type: Schema.Literal("session.execution.succeeded"), data: Schema.Struct(Session) }),
  Schema.Struct({ type: Schema.Literal("session.execution.interrupted"), data: Schema.Struct({ ...Session, reason: Schema.String }) }),
  Schema.Struct({ type: Schema.Literal("session.execution.failed"), data: Schema.Struct({ ...Session, error: ErrorInfo }) }),
  Schema.Struct({ type: Schema.Literal("session.retry.scheduled"), data: Schema.Struct({ ...Session, attempt: Schema.Finite, error: ErrorInfo }) })
])
export type OpencodeEvent = typeof OpencodeEvent.Type
const decodeEvent = Schema.decodeUnknownOption(Schema.fromJsonString(OpencodeEvent))

const fail = (what: string) => (cause: { readonly message: string }) =>
  new AgentError({ code: "session", message: `OpenCode ${what}: ${cause.message}` })

export const makeOpencodeApi = Effect.fn("makeOpencodeApi")(function*(options: { readonly url: string; readonly password: string }) {
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(HttpClientRequest.prependUrl(options.url), HttpClientRequest.basicAuth("opencode", options.password))
    )
  )

  // a call that OpenCode accepts (2xx), or fails with the status and OpenCode's error body
  const send = (what: string, request: HttpClientRequest.HttpClientRequest) =>
    client.execute(request).pipe(
      Effect.timeout(CALL_TIMEOUT),
      Effect.filterOrElse(
        (res) => res.status >= 200 && res.status < 300,
        (res) =>
          res.text.pipe(
            Effect.orElseSucceed(() => ""),
            Effect.flatMap((body) => Effect.fail({ message: `${res.status} ${body.slice(0, 500)}`.trim() }))
          )
      ),
      Effect.mapError(fail(what))
    )
  // the same, reading the JSON answer
  const call = <S extends Schema.Top>(what: string, request: HttpClientRequest.HttpClientRequest, schema: S) =>
    send(what, request).pipe(
      Effect.flatMap((res) => HttpClientResponse.schemaBodyJson(schema)(res).pipe(Effect.mapError(fail(what))))
    ) as Effect.Effect<S["Type"], AgentError, S["DecodingServices"]>
  const path = (id: string) => `/api/session/${encodeURIComponent(id)}`

  return {
    createSession: (body: { readonly title: string; readonly agent: string; readonly model: ModelRef | null; readonly directory: string }) =>
      call("session", HttpClientRequest.post("/api/session").pipe(HttpClientRequest.bodyJsonUnsafe({
        title: body.title,
        agent: body.agent,
        model: body.model,
        location: { directory: body.directory }
      })), Data(SessionInfo)).pipe(Effect.map((r) => r.data)),
    getSession: (id: string) => call("session", HttpClientRequest.get(path(id)), Data(SessionInfo)).pipe(Effect.map((r) => r.data)),
    // a resumed session moves into this run's folder (its old one is gone) and takes this run's agent and model
    moveSession: (id: string, directory: string) =>
      send("session", HttpClientRequest.post(`${path(id)}/move`).pipe(HttpClientRequest.bodyJsonUnsafe({ directory }))).pipe(Effect.asVoid),
    switchAgent: (id: string, agent: string) =>
      send("session", HttpClientRequest.post(`${path(id)}/agent`).pipe(HttpClientRequest.bodyJsonUnsafe({ agent }))).pipe(Effect.asVoid),
    switchModel: (id: string, model: ModelRef) =>
      send("session", HttpClientRequest.post(`${path(id)}/model`).pipe(HttpClientRequest.bodyJsonUnsafe({ model }))).pipe(Effect.asVoid),
    // admits the message and starts the agent; the turn itself is followed through the events
    prompt: (id: string, text: string) =>
      send("prompt", HttpClientRequest.post(`${path(id)}/prompt`).pipe(HttpClientRequest.bodyJsonUnsafe({ text }))).pipe(Effect.asVoid),
    interrupt: (id: string) => send("interrupt", HttpClientRequest.post(`${path(id)}/interrupt`)).pipe(Effect.asVoid),
    // the server's event stream, only the events Viral follows; it ends when the scope closes
    events: client.execute(HttpClientRequest.get("/api/event")).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.map((res) => res.stream),
      Stream.unwrap,
      Stream.decodeText,
      Stream.pipeThroughChannel(Sse.decode()),
      Stream.map((event) => decodeEvent(event.data)),
      Stream.filter(Option.isSome),
      Stream.map((event) => event.value),
      Stream.mapError((cause) => fail("events")({ message: String(cause) }))
    )
  }
})

export type OpencodeApi = Effect.Success<ReturnType<typeof makeOpencodeApi>>
