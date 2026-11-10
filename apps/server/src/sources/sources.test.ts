import { SHORT_NAME_MAX, SourceId, SourcesRpcs } from "@viral/contracts"
import { Effect, Layer, ManagedRuntime } from "effect"
import { RpcTest } from "effect/rpc"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { SourcesRpcLive } from "./sources-rpc.ts"
import { Sources } from "./sources.ts"
import { VideoLinks } from "./video-links.ts"

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

test("a video's short name: given when it's added, renamed over RPC, and back to automatic when cleared", async () => {
  // the RPC handlers over the real sources service; link lookups aren't part of this
  const handlers = SourcesRpcLive.pipe(
    Layer.provide(Sources.layer),
    Layer.provide(Layer.succeed(VideoLinks, VideoLinks.of({ lookup: () => Effect.die("not used") })))
  )
  const [created, unnamed, renamed, long, cleared, missing] = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    const client = yield* RpcTest.makeClient(SourcesRpcs)
    const origin = { _tag: "File", path: "/x/heidi.mp4" } as const
    const created = yield* client.CreateSource({ origin, rights: "unconfirmed", rightsNote: null, shortName: "  Heidi  " })
    const unnamed = yield* client.CreateSource({ origin, rights: "unconfirmed", rightsNote: null })
    const renamed = yield* client.RenameVideo({ id: unnamed.id, shortName: "Big   John" })
    const long = yield* client.RenameVideo({ id: unnamed.id, shortName: "x".repeat(SHORT_NAME_MAX + 10) })
    const cleared = yield* client.RenameVideo({ id: created.id, shortName: "   " })
    const missing = yield* client.RenameVideo({ id: SourceId.make("missing"), shortName: "x" }).pipe(Effect.flip)
    return [created, unnamed, renamed, long, cleared, missing] as const
  }).pipe(Effect.provide(handlers))))
  assert.equal(created.shortName, "Heidi", "trimmed")
  assert.equal(unnamed.shortName, null, "made from the title until you name it")
  assert.equal(renamed.shortName, "Big John")
  assert.equal(long.shortName?.length, SHORT_NAME_MAX)
  assert.equal(cleared.shortName, null, "a blank name goes back to automatic")
  assert.equal(missing._tag, "SourceNotFound")
})
