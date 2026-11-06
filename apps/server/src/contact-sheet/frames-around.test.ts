import { Effect, Layer, ManagedRuntime } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Sources } from "../sources/sources.ts"
import { FramesAround, frameTimes, MAX_FRAMES } from "./frames-around.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-frames-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

test("the picker's seconds sit on the step's grid, inside the video, nearest first when capped", () => {
  assert.deepEqual(frameTimes(10.4, 2, 1, 60), [9, 10, 11, 12])
  assert.deepEqual(frameTimes(0.5, 3, 1, 60), [0, 1, 2, 3], "nothing before the start")
  assert.deepEqual(frameTimes(19.5, 2, 1, 20), [18, 19], "nothing past the end")
  assert.deepEqual(frameTimes(5, 1, 0.5, null), [4, 4.5, 5, 5.5, 6])
  const wide = frameTimes(500, 400, 1, null)
  assert.equal(wide.length, MAX_FRAMES)
  assert.ok(wide.includes(500) && wide[0]! >= 470, "the cap keeps the seconds nearest the moment")
})

test("stills are extracted once at their second and served from the video's folder", async () => {
  const rt = ManagedRuntime.make(Layer.mergeAll(FramesAround.layer, Sources.layer, Artifacts.layer))
  const { sourceId, first, again } = await rt.runPromise(Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "owned", rightsNote: null })
    yield* (yield* Sources).recordMetadata(source.id, { title: "x", channel: null, url: null, durationS: 8 })
    const artifacts = yield* Artifacts
    const slot = yield* artifacts.allocate({ _tag: "Source", id: source.id }, "source-video")
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=d=8:s=320x180:r=10", join(slot.dir, "source.mp4")])
    yield* artifacts.record(slot, { data: null, path: join(slot.relDir, "source.mp4") })
    const frames = yield* FramesAround
    const first = yield* frames.list(source.id, 4.2, 1.5, 1)
    const again = yield* frames.list(source.id, 4.2, 1.5, 1)
    return { sourceId: source.id, first, again }
  }))
  assert.deepEqual(first.map((f) => f.t), [3, 4, 5])
  assert.deepEqual(first.map((f) => f.path), ["frames-around/3000.jpg", "frames-around/4000.jpg", "frames-around/5000.jpg"])
  const file = join(home, "sources", sourceId, "frames-around", "4000.jpg")
  assert.ok(existsSync(file))
  const made = statSync(file).mtimeMs
  assert.deepEqual(again, first)
  assert.equal(statSync(file).mtimeMs, made, "the second ask reuses the stills")
  await rt.dispose()
})
