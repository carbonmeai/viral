import { Effect, ManagedRuntime } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Sources } from "./sources.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-sources-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

test("a video's title and channel are yours to set, and fetching only fills in what's empty", async () => {
  const rt = ManagedRuntime.make(Sources.layer)
  const [fetched, named, refetched, cleared] = await rt.runPromise(Effect.gen(function*() {
    const sources = yield* Sources
    const source = yield* sources.create({ origin: { _tag: "File", path: "/x/source.mp4" }, rights: "unconfirmed", rightsNote: null })
    // a local file: fetching only knows its file name
    const metadata = { title: "source", channel: null, url: null, durationS: 2296 }
    yield* sources.recordMetadata(source.id, metadata)
    const fetched = yield* sources.get(source.id)
    const named = yield* sources.setDetails(source.id, " He made the world's most extreme candy ", "NileBlue")
    yield* sources.recordMetadata(source.id, metadata)
    const refetched = yield* sources.get(source.id)
    const cleared = yield* sources.setDetails(source.id, "", null)
    return [fetched, named, refetched, cleared] as const
  }))
  assert.equal(fetched.title, "source")
  assert.equal(named.title, "He made the world's most extreme candy", "trimmed")
  assert.equal(named.channel, "NileBlue")
  assert.equal(refetched.title, "He made the world's most extreme candy", "a re-fetch keeps your title")
  assert.equal(refetched.channel, "NileBlue")
  assert.equal(cleared.title, null, "an empty title clears it")
  await rt.dispose()
})
