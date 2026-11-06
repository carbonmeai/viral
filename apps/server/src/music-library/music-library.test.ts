import { Effect, Exit } from "effect"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { NodeServices } from "@effect/platform-node"
import { Layer } from "effect"
import { SecureRandom } from "effect/crypto"
import { MusicAnalysisError } from "@viral/contracts"
import { ViralHome } from "../home/viral-home.ts"
import { DatabaseLive } from "../persistence/database.ts"
import { MusicLibrary } from "./music-library.ts"
import { TrackAnalyser } from "./track-analyser.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-music-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

// fake audio can't be analysed; the library must still keep it
const library = Layer.effect(MusicLibrary, MusicLibrary.make).pipe(
  Layer.provide([
    TrackAnalyser.replay(() => new MusicAnalysisError({ code: "decode", message: "fake audio" })),
    DatabaseLive,
    ViralHome.layer,
    NodeServices.layer,
    SecureRandom.layerWebCrypto
  ])
)
const run = <A, E>(effect: Effect.Effect<A, E, MusicLibrary>) => Effect.runPromise(Effect.provide(effect, library))

test("copies a track into the library and removes it again", async () => {
  const original = join(home, "Viral Drop Song.WAV")
  writeFileSync(original, "fake audio")

  const track = await run(Effect.gen(function*() {
    return yield* (yield* MusicLibrary).add(original, null, "owned")
  }))
  const stored = join(home, "music", track.path)
  assert.equal(track.title, "Viral Drop Song")
  assert.equal(track.path, `${track.id}.wav`)
  assert.equal(readFileSync(stored, "utf8"), "fake audio")
  assert.equal(track.bpm, null)
  assert.equal(track.rights, "owned")
  assert.deepEqual(track.origin, { _tag: "Upload", file: original })

  // The library copy is independent of the original.
  rmSync(original)
  const [removed, lookup] = await run(Effect.gen(function*() {
    const music = yield* MusicLibrary
    return [yield* music.remove(track.id), yield* Effect.exit(music.get(track.id))] as const
  }))
  assert.equal(removed, true)
  assert.ok(Exit.isFailure(lookup))
  assert.ok(!existsSync(stored))
})

test("reports a file that can't be read", async () => {
  const exit = await run(Effect.exit(Effect.gen(function*() {
    return yield* (yield* MusicLibrary).add(join(home, "missing.mp3"), "Missing", "unconfirmed")
  })))
  assert.ok(Exit.isFailure(exit))
  assert.match(JSON.stringify(exit), /MusicFileUnreadable/)
})

test("a folder adds every audio file in it, new tracks are songs, and the type can change", async () => {
  const folder = join(home, "Songs")
  const { mkdirSync } = await import("node:fs")
  mkdirSync(join(folder, "nested"), { recursive: true })
  writeFileSync(join(folder, "Beat One.mp3"), "a")
  writeFileSync(join(folder, "Beat Two.WAV"), "b")
  writeFileSync(join(folder, "cover.jpg"), "not audio")
  writeFileSync(join(folder, ".hidden.mp3"), "skipped")
  writeFileSync(join(folder, "nested", "deeper.mp3"), "not picked up")

  const [result, clip, missing] = await run(Effect.gen(function*() {
    const music = yield* MusicLibrary
    const result = yield* music.addFolder(folder, "owned")
    const clip = yield* music.setKind(result.added[0]!.id, "clip")
    const missing = yield* music.addFolder(join(home, "nope"), "owned").pipe(Effect.flip)
    return [result, clip, missing] as const
  }))
  assert.deepEqual(result.added.map((t) => t.title), ["Beat One", "Beat Two"])
  assert.deepEqual(result.added.map((t) => t.kind), ["song", "song"])
  assert.deepEqual(result.skipped, [])
  assert.equal(clip.kind, "clip")
  assert.equal(missing._tag, "MusicFileUnreadable")
})
