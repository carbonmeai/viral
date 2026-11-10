import { HttpClientRequest } from "effect/http"
import { field, type KeyCheckFn, probe, serviceReason, verdict } from "../secrets/key-probe.ts"

// GET /v1/user: free, and it names the plan. ElevenLabs keys can be limited to some permissions; one without
// "User: read" is still a working key (voiceovers need Text to speech and Voices), so it passes, saying what it
// can't do.
export const checkElevenLabsKey: KeyCheckFn = (base, key) =>
  probe("ElevenLabs", key, HttpClientRequest.get(`${base}/v1/user`).pipe(HttpClientRequest.setHeader("xi-api-key", key)), ({ status, body }) => {
    if (status === 200) {
      const tier = field(field(body, "subscription"), "tier")
      return verdict("ok", typeof tier === "string" && tier !== "" ? `Works, on the ${tier} plan.` : "Works.")
    }
    if (status === 401 && /permission/i.test(serviceReason(body))) {
      return verdict(
        "ok",
        "Works, but this key has no “User: read” permission, so Settings › Usage can’t show your plan’s characters."
      )
    }
    return null
  })

export const ELEVENLABS_KEY_CHECK = { check: checkElevenLabsKey, base: "https://api.elevenlabs.io", override: "ELEVENLABS_API_URL" } as const
