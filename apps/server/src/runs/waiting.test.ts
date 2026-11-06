import { Effect, Layer, ManagedRuntime } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Projects } from "../projects/projects.ts"
import { Sources } from "../sources/sources.ts"
import { RunStore } from "./run-store.ts"
import { listWaiting } from "./waiting.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-waiting-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

test("waiting gates carry their video and short, so they can be listed globally or per video", async () => {
  const rt = ManagedRuntime.make(Layer.mergeAll(RunStore.layer, Sources.layer, Projects.layer))
  const items = await rt.runPromise(Effect.gen(function*() {
    const sources = yield* Sources
    const store = yield* RunStore
    const candy = yield* sources.create({ origin: { _tag: "Url", url: "https://youtu.be/candy" }, rights: "owned", rightsNote: null })
    const other = yield* sources.create({ origin: { _tag: "Url", url: "https://youtu.be/other" }, rights: "owned", rightsNote: null })
    const short = yield* (yield* Projects).create({ sourceId: candy.id, title: "Every taste", approach: "claim-interleaved", presetId: null, musicTrackId: null })

    // a short's gate on the candy video, and a source gate on the other video
    const shortRun = yield* store.createRun({ _tag: "Project", id: short.id }, null)
    yield* store.createRequest(yield* store.createStageRun(shortRun.id, "shots", 1, "waiting"), "Approve the shots?", null)
    const sourceRun = yield* store.createRun({ _tag: "Source", id: other.id }, null)
    yield* store.createRequest(yield* store.createStageRun(sourceRun.id, "story", 1, "waiting"), "Pick a short", null)
    return { items: yield* listWaiting(), candy, other, short }
  }))
  await rt.dispose()

  assert.equal(items.items.length, 2)
  const [shots, story] = [items.items.find((i) => i.request.stage === "shots")!, items.items.find((i) => i.request.stage === "story")!]
  assert.equal(shots.sourceId, items.candy.id)
  assert.equal(shots.projectId, items.short.id)
  assert.equal(shots.projectTitle, "Every taste")
  assert.equal(shots.projectNumber, 1)
  assert.equal(story.sourceId, items.other.id)
  assert.equal(story.projectId, null)
  // one video's list is the global list filtered by its source
  assert.deepEqual(items.items.filter((i) => i.sourceId === items.candy.id).map((i) => i.request.stage), ["shots"])
})
