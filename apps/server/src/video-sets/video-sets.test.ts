import type { SourceId } from "@viral/contracts"
import { Effect, Layer, ManagedRuntime } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Projects } from "../projects/projects.ts"
import { Sources } from "../sources/sources.ts"
import { titleFromBrief, VideoSets } from "./video-sets.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-sets-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

const runtime = () => ManagedRuntime.make(Layer.mergeAll(VideoSets.layer, Sources.layer, Projects.layer))

const addVideos = (n: number) =>
  Effect.gen(function*() {
    const sources = yield* Sources
    return yield* Effect.forEach(Array.from({ length: n }), (_, i) =>
      Effect.map(sources.create({ origin: { _tag: "File", path: `/x/${i}.mp4` }, rights: "owned", rightsNote: null }), (s) => s.id))
  })

test("a set takes 2–10 different videos and a brief, keeps their order, and is named from the brief", async () => {
  const rt = runtime()
  const result = await rt.runPromise(Effect.gen(function*() {
    const sets = yield* VideoSets
    const ids = yield* addVideos(11)
    const problem = (sourceIds: ReadonlyArray<SourceId>, brief: string) =>
      sets.create({ sourceIds, brief }).pipe(Effect.flip, Effect.map((e) => e._tag === "VideoSetInvalid" ? e.message : e._tag))
    const one = yield* problem(ids.slice(0, 1), "why")
    const eleven = yield* problem(ids, "why")
    const twice = yield* problem([ids[0]!, ids[0]!], "why")
    const noBrief = yield* problem(ids.slice(0, 2), "  ")
    const set = yield* sets.create({ sourceIds: [ids[2]!, ids[0]!, ids[1]!], brief: "  Every attempt at the candy, compared  " })
    const renamed = yield* sets.rename(set.id, " Candy attempts ")
    const listed = yield* sets.list
    return { one, eleven, twice, noBrief, set, renamed, listed, ids }
  }))
  assert.match(result.one, /at least 2 videos/)
  assert.match(result.eleven, /up to 10 videos, not 11/)
  assert.match(result.twice, /once/)
  assert.match(result.noBrief, /needs a brief/)
  assert.deepEqual(result.set.sourceIds, [result.ids[2], result.ids[0], result.ids[1]], "V1 first, in the order given")
  assert.equal(result.set.brief, "Every attempt at the candy, compared")
  assert.equal(result.set.title, "Every attempt at the candy, compared")
  assert.equal(result.renamed.title, "Candy attempts")
  assert.deepEqual(result.listed.map((s) => s.id), [result.set.id])
  await rt.dispose()
})

test("a long brief makes a short name", () => {
  const title = titleFromBrief("Compare how each of these three creators tried to build the same machine, and who actually got it working first\nmore")
  assert.ok(title.length <= 61, title)
  assert.ok(title.endsWith("…"))
  assert.ok(!title.includes("more"))
})

test("a set with shorts can't be deleted, and its videos can't be deleted while it exists", async () => {
  const rt = runtime()
  const result = await rt.runPromise(Effect.gen(function*() {
    const sets = yield* VideoSets
    const sources = yield* Sources
    const projects = yield* Projects
    const [a, b] = yield* addVideos(2)
    const set = yield* sets.create({ sourceIds: [a!, b!], brief: "why" })
    const videoInSet = yield* sources.remove(a!).pipe(Effect.flip)
    const short = yield* projects.create({
      sourceIds: [a!, b!],
      title: "Both",
      approach: "cut-down",
      presetId: null,
      musicTrackId: null,
      brief: "why",
      setId: set.id
    })
    const inUse = yield* sets.remove(set.id).pipe(Effect.flip)
    yield* projects.remove(short.id)
    const deleted = yield* sets.remove(set.id)
    const again = yield* sets.remove(set.id)
    const videoFree = yield* sources.remove(a!)
    return { videoInSet, short, inUse, deleted, again, videoFree }
  }))
  assert.equal(result.videoInSet._tag, "SourceInUse")
  assert.equal(result.short.setId !== null, true, "the short remembers its set")
  assert.equal(result.inUse.message, "used by 1 short")
  assert.equal(result.deleted, true)
  assert.equal(result.again, false)
  assert.equal(result.videoFree, true, "the video goes once no set or short uses it")
  await rt.dispose()
})
