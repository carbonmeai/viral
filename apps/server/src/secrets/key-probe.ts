import type { KeyCheckCode } from "@viral/contracts"
import { redactSecrets } from "@viral/provider-core"
import { Duration, Effect } from "effect"
import { HttpClient, type HttpClientRequest } from "effect/http"

// What a key check found, before it's stamped with a time.
export interface KeyVerdict {
  readonly code: KeyCheckCode
  readonly message: string
  readonly models: number | null
}

// One service's free key check: a call that lists models or reads the key's own info, never one that spends
// tokens. `base` is the service's address (a fake one in tests). It never fails: every outcome is a verdict.
export type KeyCheckFn = (base: string, key: string) => Effect.Effect<KeyVerdict, never, HttpClient.HttpClient>

export interface KeyAnswer {
  readonly status: number
  // the JSON body, or null when it wasn't JSON
  readonly body: unknown
}

const TIMEOUT = Duration.seconds(10)

export const verdict = (code: KeyCheckCode, message: string, models: number | null = null): KeyVerdict => ({ code, message, models })

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null

// A field of a JSON object, or undefined.
export const field = (value: unknown, name: string): unknown => record(value)?.[name]

// The service's own explanation, from the shapes they use: { error: { message } }, { error: "…" },
// { detail: { message } }, { detail: "…" }, { message }.
export const serviceReason = (body: unknown): string => {
  const error = field(body, "error")
  const detail = field(body, "detail")
  const candidates = [field(error, "message"), error, field(detail, "message"), detail, field(body, "message")]
  const text = candidates.find((c): c is string => typeof c === "string" && c.trim() !== "")
  return text === undefined ? "" : text.trim().replace(/\s+/g, " ").slice(0, 200).replace(/\.$/, "")
}

// Sends a service's check request and turns the answer into a verdict. `read` handles what is particular to the
// service (a 2xx body, an odd status) and returns null to leave the rest to the common rules:
//   401/403 → refused · 402 → no credit · 5xx, a timeout or no connection → unreachable · 429 → try again.
// Messages never carry the key: the service's text is redacted before it's used.
export const probe = (
  service: string,
  key: string,
  request: HttpClientRequest.HttpClientRequest,
  read: (answer: KeyAnswer) => KeyVerdict | null
): Effect.Effect<KeyVerdict, never, HttpClient.HttpClient> =>
  Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    const res = yield* client.execute(request).pipe(Effect.timeout(TIMEOUT))
    const body = yield* res.json.pipe(Effect.orElseSucceed(() => null))
    const answer: KeyAnswer = { status: res.status, body }
    const own = read(answer)
    const reason = redactSecrets(serviceReason(body), [key])
    const because = reason === "" ? "" : ` (${reason})`
    const result = own ?? (
      res.status >= 200 && res.status < 300
        ? verdict("ok", "Works.")
        : res.status === 401 || res.status === 403
        ? verdict("refused", `${service} refused this key${because}.`)
        : res.status === 402
        ? verdict("no-credit", `This key works but has no credit left${because}.`)
        : res.status === 429
        ? verdict("unknown", `${service} is busy right now (too many requests). Test again in a minute.`)
        : res.status >= 500
        ? verdict("unreachable", `${service} isn't answering right now (${res.status}).`)
        : verdict("unknown", `${service} answered with ${res.status}${because}.`)
    )
    return { ...result, message: redactSecrets(result.message, [key]) }
  }).pipe(
    Effect.orElseSucceed(() => verdict("unreachable", `Couldn't reach ${service}.`)),
    Effect.withSpan("KeyCheck.probe", { attributes: { service } })
  )

// "Works. 63 models available."
export const worksWithModels = (count: number) =>
  verdict("ok", count === 1 ? "Works. 1 model available." : `Works. ${count} models available.`, count)

// "$12.34"
export const dollars = (amount: number) => `$${amount.toFixed(2)}`
