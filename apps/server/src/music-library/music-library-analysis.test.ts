import { NodeServices } from "@effect/platform-node"
import { MusicAnalysisError } from "@viral/contracts"
import { Effect, Layer, Schedule } from "effect"
import { SecureRandom } from "effect/crypto"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { ViralHome } from "../home/viral-home.ts"
import { DatabaseLive } from "../persistence/database.ts"
import { MusicLibrary } from "./music-library.ts"
import { type TrackAnalysis, TrackAnalyser } from "./track-analyser.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-music-analysis-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

// The analyser's answer by file name: a track with a drop, one without, and one that can't be read.
const answers: Record<string, TrackAnalysis | MusicAnalysisError> = {
  "drop.wav": { bpm: 120, dropS: 12, loudnessLufs: -9.5, durationS: 30, confidence: 0.9 },
  "calm.wav": { bpm: 90, dropS: null, loudnessLufs: -14, durationS: 40, confidence: 0.2 },
  "broken.wav": new MusicAnalysisError({ code: "decode", message: "can't read the audio" })
}
// the library stores a copy under the track's id, so the fake tells tracks apart by their content
const analyser = TrackAnalyser.replay((file) => answers[readFileSync(file, "utf8")]!)

const run = <A, E>(effect: Effect.Effect<A, E, MusicLibrary>) =>
  Effect.runPromise(Effect.provide(
    effect,
    Layer.effect(MusicLibrary, MusicLibrary.make).pipe(
      Layer.provide([analyser, DatabaseLive, ViralHome.layer, NodeServices.layer, SecureRandom.layerWebCrypto])
    )
  ))

const file = (name: string) => {
  const path = join(home, name)
  writeFileSync(path, name)
  return path
}

test("adding a track analyses it in the background", async () => {
  const track = await run(Effect.gen(function*() {
    const music = yield* MusicLibrary
    const added = yield* music.add(file("drop.wav"), null, "owned")
    // the analysis runs on its own fiber; wait for it to land
    return yield* music.get(added.id).pipe(
      Effect.filterOrFail((t) => t.analyzedAt !== null, () => "pending" as const),
      Effect.retry({ schedule: Schedule.spaced("20 millis"), times: 100 })
    )
  }))
  assert.deepEqual([track.bpm, track.dropS, track.beatSource, track.loudnessLufs, track.durationS], [120, 12, "analysis", -9.5, 30])
})

test("a tempo and drop you set are never overwritten by analysis", async () => {
  const track = await run(Effect.gen(function*() {
    const music = yield* MusicLibrary
    const added = yield* music.add(file("drop.wav"), "Mine", "owned")
    yield* music.setBeat(added.id, 117.5, 16.588)
    return yield* music.analyse(added.id)
  }))
  assert.deepEqual([track.bpm, track.dropS, track.beatSource], [117.5, 16.588, "manual"])
  assert.equal(track.loudnessLufs, -9.5, "loudness and length are still measured")
  assert.notEqual(track.analyzedAt, null)
})

test("a track without a clear drop is fine, and one that can't be analysed stays in the library", async () => {
  const [calm, broken, error] = await run(Effect.gen(function*() {
    const music = yield* MusicLibrary
    const calm = yield* music.analyse((yield* music.add(file("calm.wav"), null, "owned")).id)
    const added = yield* music.add(file("broken.wav"), null, "owned")
    const error = yield* Effect.flip(music.analyse(added.id))
    return [calm, yield* music.get(added.id), error] as const
  }))
  assert.deepEqual([calm.bpm, calm.dropS, calm.beatSource], [90, null, "analysis"])
  assert.equal(broken.analyzedAt, null)
  assert.equal(error._tag, "MusicAnalysisError")
})
