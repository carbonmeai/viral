import { HttpClientRequest } from "effect/http"
import { field, type KeyCheckFn, probe, serviceReason, verdict } from "../secrets/key-probe.ts"

// GET /v1/api-key: the key's own record, free. A key can exist and still be switched off, or belong to a team xAI
// has blocked (usually for having no credit left).
export const checkXaiKey: KeyCheckFn = (base, key) =>
  probe("xAI", key, HttpClientRequest.get(`${base}/v1/api-key`).pipe(HttpClientRequest.bearerToken(key)), ({ status, body }) => {
    // a wrong key is a 400 there ("Incorrect API key provided"), not a 401
    if (status === 400 && /api key/i.test(serviceReason(body))) return verdict("refused", "xAI refused this key (it isn't a valid API key).")
    if (status !== 200) return null
    if (field(body, "api_key_disabled") === true) return verdict("refused", "xAI says this key is switched off. Turn it on in the xAI console, or make a new one.")
    if (field(body, "api_key_blocked") === true) return verdict("refused", "xAI has blocked this key.")
    if (field(body, "team_blocked") === true) {
      return verdict("no-credit", "This key works but xAI has blocked its team, usually because it has no credit left.")
    }
    return verdict("ok", "Works.")
  })

export const XAI_KEY_CHECK = { check: checkXaiKey, base: "https://api.x.ai", override: "XAI_API_URL" } as const
