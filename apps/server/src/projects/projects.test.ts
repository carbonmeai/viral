import { SourceId } from "@viral/contracts"
import { Effect, Exit, Layer } from "effect"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Sources } from "../sources/sources.ts"
import { Projects } from "./projects.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-projects-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

// Each call builds the layers from scratch, like a server restart against the same database.
const run = <A, E>(effect: Effect.Effect<A, E, Projects | Sources>) =>
  Effect.runPromise(Effect.provide(effect, Layer.mergeAll(Projects.layer, Sources.layer)))

test("numbers shorts per source and slugs them from the title", async () => {
  const { source, first, second } = await run(Effect.gen(function*() {
    const sources = yield* Sources
    const projects = yield* Projects
    const source = yield* sources.create({
      origin: { _tag: "File", path: "/videos/candy.mp4" },
      rights: "unconfirmed",
      rightsNote: null
    })
    const make = (title: string) =>
      projects.create({ sourceId: source.id, title, approach: "question-recap", presetId: null, musicTrackId: null })
    return { source, first: yield* make("He Put Every Taste Into One Candy"), second: yield* make("The Glue Batch") }
  }))
  assert.equal(first.slug, "01-he-put-every-taste-into-one-candy")
  assert.equal(second.slug, "02-the-glue-batch")
  assert.equal(first.format, "narrated", "the format follows the approach")
  assert.ok(existsSync(join(home, "sources", source.id)))
  assert.ok(existsSync(join(home, "projects", first.id)))

  // A fresh layer reads what the previous one wrote.
  const listed = await run(Effect.gen(function*() {
    return yield* (yield* Projects).list(source.id)
  }))
  assert.deepEqual(listed.map((p) => p.number), [1, 2])
})

test("rejects a short for an unknown source with a typed error", async () => {
  const exit = await run(Effect.exit(Effect.gen(function*() {
    const projects = yield* Projects
    return yield* projects.create({
      sourceId: SourceId.make("missing"),
      title: "x",
      approach: "cut-down",
      presetId: null,
      musicTrackId: null
    })
  })))
  assert.ok(Exit.isFailure(exit))
  assert.match(JSON.stringify(exit), /SourceNotFound/)
})

test("deleting a source removes its shorts and their folders", async () => {
  const { source, short } = await run(Effect.gen(function*() {
    const sources = yield* Sources
    const projects = yield* Projects
    const source = yield* sources.create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "owned", rightsNote: null })
    const short = yield* projects.create({
      sourceId: source.id,
      title: "Only short",
      approach: "claim-interleaved",
      presetId: null,
      musicTrackId: null
    })
    return { source, short }
  }))

  const [deleted, lookup, deletedAgain] = await run(Effect.gen(function*() {
    const sources = yield* Sources
    const projects = yield* Projects
    return [
      yield* sources.remove(source.id),
      yield* Effect.exit(projects.get(short.id)),
      yield* sources.remove(source.id)
    ] as const
  }))
  assert.equal(deleted, true)
  assert.ok(Exit.isFailure(lookup))
  assert.equal(deletedAgain, false)
  assert.ok(!existsSync(join(home, "sources", source.id)))
  assert.ok(!existsSync(join(home, "projects", short.id)))
})
