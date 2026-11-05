import type { JobEvent } from "@viral/contracts"
import { Effect, Exit, Layer } from "effect"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Artifacts } from "../artifacts/artifacts.ts"
import { makeTestVideo } from "../testing/test-video.ts"
import { SourceStages } from "./source-stages.ts"
import { Sources } from "./sources.ts"

let work: string
let video: string
before(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "viral-stages-")))
  process.env.VIRAL_HOME = join(work, "home")
  video = join(work, "My Long Video.mp4")
  makeTestVideo(video, 12)
})
after(() => rmSync(work, { recursive: true, force: true }))

const layer = Layer.mergeAll(SourceStages.layer, Sources.layer, Artifacts.layer)
const run = <A, E>(effect: Effect.Effect<A, E, SourceStages | Sources | Artifacts>) =>
  Effect.runPromise(Effect.provide(effect, layer))

test("source and contact-sheet stages record versioned source artifacts", async () => {
  const events: Array<JobEvent> = []
  const emit = (event: JobEvent) => Effect.sync(() => void events.push(event))

  const { source, artifacts } = await run(Effect.gen(function*() {
    const sources = yield* Sources
    const stages = yield* SourceStages
    const source = yield* sources.create({ origin: { _tag: "File", path: video }, rights: "owned", rightsNote: null })
    yield* stages.run(source.id, "source", false, emit)
    yield* stages.run(source.id, "contact-sheet", false, emit)
    yield* stages.run(source.id, "source", false, emit) // already done: skipped
    yield* stages.run(source.id, "source", true, emit) // forced: version 2
    return { source: yield* sources.get(source.id), artifacts: yield* (yield* Artifacts).list({ _tag: "Source", id: source.id }) }
  }))

  assert.equal(source.title, "My Long Video")
  assert.ok(source.durationS !== null && Math.abs(source.durationS - 12) < 0.2)
  assert.deepEqual(artifacts.map((a) => `${a.kind}@${a.version}`), ["contact-sheet@1", "source-video@2", "source-video@1"])

  const sourceDir = join(work, "home/sources", source.id)
  const v1 = join(sourceDir, "source-video/v1/source.mp4")
  assert.equal(statSync(v1).ino, statSync(video).ino, "a local mp4 is hard-linked, not copied")
  assert.ok(existsSync(join(sourceDir, "contact-sheet/v1/sheet_000.png")))

  // A tile every 5s: 0s and 5s. ffmpeg's fps filter only emits the 10s tile once the video runs half an
  // interval past it (12.5s), so a 12s clip has two.
  const sheetData = artifacts[0]!.data as { readonly frames: number; readonly sheets: ReadonlyArray<{ start: number; end: number }> }
  assert.equal(sheetData.frames, 2)
  assert.deepEqual(sheetData.sheets.map((s) => [s.start, s.end]), [[0, 5]])
  assert.ok(events.some((e) => e._tag === "StageSkipped" && e.stage === "source"))
})

test("a later stage before the source stage fails with not-ready", async () => {
  const exit = await run(Effect.exit(Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "File", path: video }, rights: "owned", rightsNote: null })
    return yield* (yield* SourceStages).run(source.id, "transcribe", false, () => Effect.void)
  })))
  assert.ok(Exit.isFailure(exit))
  assert.match(JSON.stringify(exit), /not-ready/)
})
