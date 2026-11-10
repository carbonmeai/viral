import { RESEARCH_SEARCHES } from "@viral/contracts"
import { Duration, Effect } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, afterEach, before, test } from "node:test"
import { emptyCatalog, isDetails, researchTools } from "./research-tools.ts"
import { FAKE_YT_DLP } from "./testing/fake-youtube.ts"
import { YouTube } from "./youtube.ts"

let dir: string
let log: string
before(() => {
  dir = mkdtempSync(join(tmpdir(), "viral-research-tools-"))
  log = join(dir, "calls.log")
  process.env["FAKE_YT_LOG"] = log
})
after(() => {
  delete process.env["FAKE_YT_LOG"]
  rmSync(dir, { recursive: true, force: true })
})
afterEach(() => {
  delete process.env["FAKE_YT_BLOCK"]
  delete process.env["FAKE_YT_UNAVAILABLE"]
})

const calls = () => readFileSync(log, "utf8").trim().split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Array<string>)

const withTools = <A>(f: (tools: ReturnType<typeof researchTools>, catalog: ReturnType<typeof emptyCatalog>, progress: Array<string>) => Effect.Effect<A>) =>
  Effect.runPromise(Effect.gen(function*() {
    const youtube = yield* YouTube
    const catalog = emptyCatalog()
    const progress: Array<string> = []
    return yield* f(researchTools(youtube, catalog, (m) => Effect.sync(() => void progress.push(m))), catalog, progress)
  }).pipe(Effect.provide(YouTube.layerWith({ command: FAKE_YT_DLP, spacing: Duration.zero, fetchThumbnail: () => Effect.succeed(false) }))))

const call = (tools: ReturnType<typeof researchTools>, name: string, input: unknown) => tools.find((t) => t.name === name)!.run(input).pipe(Effect.map((a) => a.text))

test("search_youtube runs one flat search and lists each result; a junk search is just results", async () => {
  const { text, junk, catalog, progress } = await withTools((tools, catalog, progress) =>
    Effect.gen(function*() {
      const text = yield* call(tools, "search_youtube", { query: "matted dog rescue transformation" })
      const junk = yield* call(tools, "search_youtube", { query: "fox bird wild animal rescue transformation" })
      return { text, junk, catalog, progress }
    }))
  assert.match(text, /^Si0P5CmgiwU \| 8:01 \| 4\.0M views \| The Dodo \| Extremely Matted Dog Transforms To The Cutest Pup \| The Dodo$/m)
  assert.match(text, /jBR63No8O7s \| 1:05:01 \|/, "hour-long videos are listed; the checks keep them off the list")
  assert.match(text, /\(19 searches left\)/)
  assert.match(junk, /Power Rangers Beast Hunters/)
  assert.deepEqual(catalog.searches, ["matted dog rescue transformation", "fox bird wild animal rescue transformation"])
  assert.equal(catalog.videos.size, 16)
  assert.match(progress[0]!, /searching YouTube \(1 of 20\): matted dog/)
  const search = calls().find((c) => c.includes("ytsearch8:matted dog rescue transformation"))
  assert.ok(search?.includes("--flat-playlist"), "a search is one flat request")
})

test("video_details reads the description, chapters and the start of the captions, without downloading", async () => {
  const text = await withTools((tools) => call(tools, "video_details", { video: "https://youtu.be/XMkilsT2Ahs" }))
  assert.match(text, /Dog So Matted She Looked Like a Walking Cotton Ball/)
  assert.match(text, /id XMkilsT2Ahs · The Dodo · 1:43 · 3\.4M views · uploaded 2026-02-07/)
  assert.match(text, /\[0:30\] At the vet/)
  assert.match(text, /Captions \(the start, times are rough\):\n\[0:01\] We found Dog So Matted by the road\.\n\[0:30\] At the vet she got fluids and a bath\./)
  assert.match(text, /\(19 lookups left\)/)
  const lookup = calls().find((c) => c.at(-1) === "https://www.youtube.com/watch?v=XMkilsT2Ahs")!
  assert.ok(lookup.includes("--skip-download"))
  assert.ok(!lookup.some((a) => a.startsWith("-f")), "no format is ever downloaded")
})

test("the tools stop at their limits, and once YouTube refuses they stop asking", async () => {
  const capped = await withTools((tools, catalog) =>
    Effect.gen(function*() {
      for (let i = 0; i < RESEARCH_SEARCHES; i++) catalog.searches.push(`q${i}`)
      catalog.lookups = 20
      return [yield* call(tools, "search_youtube", { query: "one more" }), yield* call(tools, "video_details", { video: "XMkilsT2Ahs" })]
    }))
  assert.match(capped[0]!, /used all 20 searches/)
  assert.match(capped[1]!, /used all 20 lookups/)

  process.env["FAKE_YT_UNAVAILABLE"] = "A3qhJbqA--k"
  const gone = await withTools((tools, catalog) =>
    Effect.map(call(tools, "video_details", { video: "A3qhJbqA--k" }), (text) => ({ text, unavailable: catalog.unavailable.has("A3qhJbqA--k") })))
  assert.match(gone.text, /Couldn't look up A3qhJbqA--k: .*removed.*Don't pick it/)
  assert.ok(gone.unavailable)

  process.env["FAKE_YT_BLOCK"] = "all"
  const before = calls().length
  const refused = await withTools((tools, catalog) =>
    Effect.gen(function*() {
      const first = yield* call(tools, "search_youtube", { query: "dog rescue transformation before after" })
      const second = yield* call(tools, "video_details", { video: "Si0P5CmgiwU" })
      return { first, second, blocked: catalog.blocked }
    }))
  assert.match(refused.first, /YouTube refused an earlier request \(YouTube refused the request/)
  assert.match(refused.second, /Don't try again: propose from the videos you already found/)
  assert.notEqual(refused.blocked, null)
  assert.equal(calls().length - before, 1, "after a refusal nothing more is asked")
})

test("a thumbnail is saved through the fetcher into the given file", async () => {
  const saved: Array<string> = []
  const ok = await Effect.runPromise(Effect.gen(function*() {
    return yield* (yield* YouTube).saveThumbnail("XMkilsT2Ahs", join(dir, "sets", "s", "thumbs", "XMkilsT2Ahs.jpg"))
  }).pipe(Effect.provide(YouTube.layerWith({ command: FAKE_YT_DLP, fetchThumbnail: (id, file) => Effect.sync(() => (saved.push(`${id} ${file}`), true)) }))))
  assert.ok(ok)
  assert.match(saved[0]!, /^XMkilsT2Ahs .*sets\/s\/thumbs\/XMkilsT2Ahs\.jpg$/)
  assert.ok(isDetails({ videoId: "x", title: "t", channel: null, durationS: 1, views: 1, live: false, uploadDate: null, description: "", chapters: [], captions: null }))
})
