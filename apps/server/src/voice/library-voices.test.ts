import { ConfigProvider, Effect } from "effect"
import assert from "node:assert/strict"
import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { after, before, test } from "node:test"
import { ElevenLabs } from "./eleven-labs.ts"

// A fake ElevenLabs: the shared library, your voices, adding (with a slot limit) and removing.
let server: Server
let base: string
const requests: Array<{ method: string; url: string; body: string }> = []
let slotsLeft = 1
const mine = [
  { voice_id: "premade-1", name: "Adam - Dominant, Firm", category: "premade", labels: {}, preview_url: null },
  { voice_id: "added-1", name: "Marvin - Audiobooks", category: "professional", labels: {}, preview_url: null }
]
const shared = (id: string, extra: Record<string, unknown> = {}) => ({
  voice_id: id,
  public_owner_id: `owner-${id}`,
  name: `${id} - Deep narrator`,
  description: "A calm storyteller",
  language: "en",
  locale: "en-US",
  accent: "british",
  gender: "male",
  age: "middle_aged",
  use_case: "narrative_story",
  category: "professional",
  preview_url: `https://samples.example/${id}.mp3`,
  date_unix: 1_700_000_000,
  cloned_by_count: 252_800,
  featured: false,
  verified_languages: [{ language: "en" }, { language: "es" }, { language: "pt" }, { language: "en" }],
  ...extra
})

const body = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = ""
    req.on("data", (chunk) => void (data += chunk))
    req.on("end", () => resolve(data))
  })

before(async () => {
  server = createServer(async (req, res) => {
    const text = await body(req)
    requests.push({ method: req.method ?? "", url: req.url ?? "", body: text })
    const json = (status: number, value: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value))
    if (req.headers["xi-api-key"] !== "test-key") return json(401, { detail: { status: "invalid_api_key", message: "bad key" } })
    const url = new URL(req.url ?? "", "http://x")
    if (req.method === "GET" && url.pathname === "/v1/shared-voices") {
      return json(200, { voices: [shared("added-1"), shared("new-1", { verified_languages: [] })], has_more: true, total_count: 8734 })
    }
    if (req.method === "GET" && url.pathname === "/v1/voices") return json(200, { voices: mine })
    const add = url.pathname.match(/^\/v1\/voices\/add\/([^/]+)\/([^/]+)$/)
    if (req.method === "POST" && add !== null) {
      if (slotsLeft === 0) return json(400, { detail: { status: "voice_limit_reached", message: "You have reached your maximum amount of custom voices (10 / 10)." } })
      slotsLeft--
      mine.push({ voice_id: add[2]!, name: JSON.parse(text).new_name, category: "professional", labels: {}, preview_url: null })
      return json(200, { voice_id: add[2] })
    }
    const del = url.pathname.match(/^\/v1\/voices\/([^/]+)$/)
    if (req.method === "DELETE" && del !== null) return json(200, { status: "ok" })
    json(404, { detail: "not found" })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => void server.close())

const run = <A, E>(use: (eleven: ElevenLabs["Service"]) => Effect.Effect<A, E>) =>
  // the key is read on each call, so the settings wrap the whole run, not just the client's construction
  Effect.runPromise(Effect.flatMap(ElevenLabs, use).pipe(
    Effect.provide(ElevenLabs.layer),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ ELEVENLABS_API_KEY: "test-key", ELEVENLABS_API_URL: base })))
  ))

const query = { search: " deep ", language: "en", useCase: "narrative_story", gender: null, age: null, sort: "trending", page: 2 } as const

test("Explore pages the shared library with your filters and marks the voices you already have", async () => {
  requests.length = 0
  const result = await run((eleven) => eleven.explore(query))
  const asked = new URL(requests.find((r) => r.url.startsWith("/v1/shared-voices"))!.url, "http://x").searchParams
  assert.equal(asked.get("search"), "deep")
  assert.equal(asked.get("language"), "en")
  assert.equal(asked.get("use_cases"), "narrative_story")
  assert.equal(asked.get("page"), "2")
  assert.equal(asked.get("sort"), "trending")
  assert.equal(asked.has("gender"), false, "unset filters aren't sent")
  assert.deepEqual({ total: result.total, hasMore: result.hasMore, page: result.page }, { total: 8734, hasMore: true, page: 2 })
  const [have, fresh] = result.voices
  assert.equal(have?.inMyVoices, true)
  assert.equal(fresh?.inMyVoices, false)
  assert.equal(have?.extraLanguages, 2, "es and pt beyond its own")
  assert.equal(fresh?.extraLanguages, 0)
  assert.equal(have?.users, 252_800)
  assert.equal(have?.publicOwnerId, "owner-added-1")
})

test("adding a library voice uses a slot, and a full plan says so plainly", async () => {
  slotsLeft = 1
  const added = await run((eleven) => eleven.addShared("owner-new-1", "new-1", "Narrator"))
  assert.equal(added.voiceId, "new-1")
  assert.equal(added.name, "Narrator")
  const refused = await run((eleven) => Effect.flip(eleven.addShared("owner-x", "x", null)))
  assert.equal(refused.code, "limit")
  assert.match(refused.message, /no voice slot left .*10 \/ 10/)
})

test("only voices you added can be removed; ElevenLabs' own are kept", async () => {
  requests.length = 0
  assert.equal(await run((eleven) => eleven.remove("added-1")), true)
  assert.ok(requests.some((r) => r.method === "DELETE" && r.url === "/v1/voices/added-1"))
  const premade = await run((eleven) => Effect.flip(eleven.remove("premade-1")))
  assert.equal(premade.code, "not-removable")
  assert.equal(requests.filter((r) => r.method === "DELETE").length, 1, "nothing was sent for the premade voice")
  assert.equal(await run((eleven) => eleven.remove("unknown")), false)
})
