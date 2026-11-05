import { Effect, Exit } from "effect"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { MusicLibrary } from "./music-library.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-music-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

const run = <A, E>(effect: Effect.Effect<A, E, MusicLibrary>) =>
  Effect.runPromise(Effect.provide(effect, MusicLibrary.layer))

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
