import { MusicTrackId, PresetId, SourceId } from "@viral/contracts"
import { Effect, Exit, Layer } from "effect"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Presets } from "../presets/presets.ts"
import { Sources } from "../sources/sources.ts"
import { Projects } from "./projects.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-projects-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

// Each call builds the layers from scratch, like a server restart against the same database.
const run = <A, E>(effect: Effect.Effect<A, E, Projects | Sources | Artifacts>) =>
  Effect.runPromise(Effect.provide(effect, Layer.mergeAll(Projects.layer, Sources.layer, Artifacts.layer)))

test("numbers shorts and slugs them from the title", async () => {
  const { source, first, second } = await run(Effect.gen(function*() {
    const sources = yield* Sources
    const projects = yield* Projects
    const source = yield* sources.create({
      origin: { _tag: "File", path: "/videos/candy.mp4" },
      rights: "unconfirmed",
      rightsNote: null
    })
    const make = (title: string) =>
      projects.create({ sourceIds: [source.id], title, approach: "question-recap", presetId: null, musicTrackId: null })
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
      sourceIds: [SourceId.make("missing")],
      title: "x",
      approach: "cut-down",
      presetId: null,
      musicTrackId: null
    })
  })))
  assert.ok(Exit.isFailure(exit))
  assert.match(JSON.stringify(exit), /SourceNotFound/)
})

test("a video a short uses can't be deleted; once its shorts are gone, it can", async () => {
  const { source, short } = await run(Effect.gen(function*() {
    const sources = yield* Sources
    const projects = yield* Projects
    const source = yield* sources.create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "owned", rightsNote: null })
    const short = yield* projects.create({
      sourceIds: [source.id],
      title: "Only short",
      approach: "claim-interleaved",
      presetId: null,
      musicTrackId: null
    })
    return { source, short }
  }))

  const [refused, deleted, deletedAgain] = await run(Effect.gen(function*() {
    const sources = yield* Sources
    const projects = yield* Projects
    const refused = yield* sources.remove(source.id).pipe(Effect.flip)
    yield* projects.remove(short.id)
    return [refused, yield* sources.remove(source.id), yield* sources.remove(source.id)] as const
  }))
  assert.equal(refused._tag, "SourceInUse")
  assert.equal(refused.message, "used by 1 short")
  assert.equal(deleted, true)
  assert.equal(deletedAgain, false)
  assert.ok(!existsSync(join(home, "sources", source.id)))
  assert.ok(!existsSync(join(home, "projects", short.id)))
})

test("a short can use several videos, in order, with a brief; shorts are numbered across the library", async () => {
  const result = await run(Effect.gen(function*() {
    const sources = yield* Sources
    const projects = yield* Projects
    const video = () => sources.create({ origin: { _tag: "File", path: "/videos/x.mp4" }, rights: "owned", rightsNote: null })
    const [a, b, c] = [yield* video(), yield* video(), yield* video()]
    const base = { approach: "cut-down" as const, presetId: null, musicTrackId: null }
    const one = yield* projects.create({ ...base, sourceIds: [a.id], title: "From A" })
    const several = yield* projects.create({ ...base, sourceIds: [c.id, a.id], title: "From C and A", brief: "compare them" })
    const noBrief = yield* projects.create({ ...base, sourceIds: [a.id, b.id], title: "x" }).pipe(Effect.flip)
    const twice = yield* projects.create({ ...base, sourceIds: [a.id, a.id], title: "x", brief: "b" }).pipe(Effect.flip)
    const unknown = yield* projects.create({ ...base, sourceIds: [a.id, SourceId.make("missing")], title: "x", brief: "b" }).pipe(Effect.flip)
    const inUse = yield* sources.remove(c.id).pipe(Effect.flip)
    return {
      one,
      several: yield* projects.get(several.id),
      usingA: (yield* projects.list(a.id)).map((p) => p.title),
      usingB: yield* projects.list(b.id),
      errors: [noBrief._tag, twice._tag, unknown._tag],
      messages: [noBrief.message, twice.message],
      inUse: inUse.message
    }
  }))
  assert.deepEqual(result.several.sourceIds.length, 2)
  assert.equal(result.several.number, result.one.number + 1, "numbered after every other short, whatever its video")
  assert.match(result.several.slug, /^\d\d-from-c-and-a$/)
  assert.equal(result.several.setId, null)
  assert.deepEqual(result.usingA, ["From A", "From C and A"])
  assert.deepEqual(result.usingB, [])
  assert.deepEqual(result.errors, ["ProjectSourcesInvalid", "ProjectSourcesInvalid", "SourceNotFound"])
  assert.deepEqual(result.messages, ["a short from several videos needs a brief: what should it achieve?", "each video can be in a short once"])
  assert.equal(result.inUse, "used by 1 short")
})

test("a short's style can be changed, checked against the presets, and reset to the default", async () => {
  const { styled, reset, missing } = await Effect.runPromise(Effect.provide(Effect.gen(function*() {
    const sources = yield* Sources
    const projects = yield* Projects
    const presets = yield* Presets
    const source = yield* sources.create({ origin: { _tag: "File", path: "/videos/candy.mp4" }, rights: "owned", rightsNote: null })
    const project = yield* projects.create({ sourceIds: [source.id], title: "Style", approach: "claim-interleaved", presetId: null, musicTrackId: null })
    const fullBleed = (yield* presets.list).find((p) => p.name === "Headline full-bleed")!
    const styled = yield* projects.setPreset(project.id, fullBleed.id)
    const missing = yield* projects.setPreset(project.id, PresetId.make("nope")).pipe(Effect.flip)
    const reset = yield* projects.setPreset(project.id, null)
    return { styled: styled.presetId === fullBleed.id, reset: reset.presetId, missing: missing._tag }
  }), Layer.mergeAll(Projects.layer, Sources.layer, Presets.layer)))
  assert.ok(styled)
  assert.equal(missing, "PresetNotFound")
  assert.equal(reset, null)
})

test("a short's music can be set to a library track or back to voice only", async () => {
  const { unknown, cleared } = await Effect.runPromise(Effect.provide(Effect.gen(function*() {
    const sources = yield* Sources
    const projects = yield* Projects
    const source = yield* sources.create({ origin: { _tag: "File", path: "/videos/candy.mp4" }, rights: "owned", rightsNote: null })
    const project = yield* projects.create({ sourceIds: [source.id], title: "Music", approach: "question-recap", presetId: null, musicTrackId: null })
    const unknown = yield* projects.setMusic(project.id, MusicTrackId.make("nope")).pipe(Effect.flip)
    const cleared = yield* projects.setMusic(project.id, null)
    return { unknown: unknown._tag, cleared: cleared.musicTrackId }
  }), Layer.mergeAll(Projects.layer, Sources.layer)))
  assert.equal(unknown, "MusicTrackNotFound")
  assert.equal(cleared, null)
})

test("a short keeps your brief, trimmed; a blank one clears it", async () => {
  const [created, none, changed, cleared] = await run(Effect.gen(function*() {
    const sources = yield* Sources
    const projects = yield* Projects
    const source = yield* sources.create({ origin: { _tag: "File", path: "/videos/candy.mp4" }, rights: "owned", rightsNote: null })
    const base = { sourceIds: [source.id] as const, approach: "question-recap" as const, presetId: null, musicTrackId: null }
    const created = yield* projects.create({ ...base, title: "With a brief", brief: "  Focus on the friend's reactions.  " })
    const none = yield* projects.create({ ...base, title: "Without one" })
    const changed = yield* projects.setBrief(created.id, "End on the joke.")
    const cleared = yield* projects.setBrief(created.id, "   ")
    return [created, none, changed, cleared] as const
  }))
  assert.equal(created.brief, "Focus on the friend's reactions.")
  assert.equal(none.brief, null)
  assert.equal(changed.brief, "End on the joke.")
  assert.equal(cleared.brief, null)
})

test("adds a video to a short and removes it again; removal is refused while a step's work uses it", async () => {
  const outcome = await run(Effect.gen(function*() {
    const sources = yield* Sources
    const projects = yield* Projects
    const artifacts = yield* Artifacts
    const make = (url: string, title: string) =>
      Effect.flatMap(sources.create({ origin: { _tag: "Url", url }, rights: "licensed", rightsNote: null }), (s) => sources.setDetails(s.id, title, null))
    const candy = yield* make("https://youtu.be/candy", "Candy")
    const heidi = yield* make("https://youtu.be/heidi", "Heidi Klum")
    const gum = yield* make("https://youtu.be/gum", "Gum")
    const short = yield* projects.create({ sourceIds: [candy.id], title: "One", approach: "cut-down", presetId: null, musicTrackId: null })
    yield* projects.addSource(short.id, heidi.id)
    const added = yield* projects.addSource(short.id, gum.id)
    const twice = yield* Effect.flip(projects.addSource(short.id, gum.id))

    // the sections use Gum (V3)
    const owner = { _tag: "Project", id: short.id } as const
    const section = (source?: number) => ({ beat: "hook", start: 0, end: 5, text: "t", note: "", frame: null, ...(source === undefined ? {} : { source }) })
    yield* artifacts.record(yield* artifacts.allocate(owner, "cut-plan"), { data: { hookText: null, sections: [section(), section(2)], storyboard: null }, path: null })
    const gumUsed = yield* Effect.flip(projects.removeSource(short.id, gum.id))
    const heidiBefore = yield* Effect.flip(projects.removeSource(short.id, heidi.id))
    // a new version of the sections no longer uses Gum
    yield* artifacts.record(yield* artifacts.allocate(owner, "cut-plan"), { data: { hookText: null, sections: [section(), section(1)], storyboard: null }, path: null })
    const withoutGum = yield* projects.removeSource(short.id, gum.id)
    const only = yield* Effect.flip(projects.removeSource(short.id, heidi.id).pipe(Effect.andThen(projects.removeSource(short.id, candy.id))))
    return { added, twice, gumUsed, heidiBefore, withoutGum, only, ids: { candy: candy.id, heidi: heidi.id } }
  }))
  assert.equal(outcome.added.sourceIds.length, 3)
  assert.equal(outcome.twice._tag, "ProjectSourcesInvalid")
  assert.equal(outcome.gumUsed._tag, "ProjectSourceInUse")
  assert.equal(outcome.gumUsed.message, "\"Gum\" can't be removed: the sections use it. Change that step so it doesn't use it first.")
  assert.equal(outcome.heidiBefore.message, "\"Heidi Klum\" can't be removed while the sections use \"Gum\", which was added after it.")
  assert.deepEqual(outcome.withoutGum.sourceIds, [outcome.ids.candy, outcome.ids.heidi])
  // Heidi Klum is used now (section 2), so it stays; the first video can't go while she's after it
  assert.equal(outcome.only._tag, "ProjectSourceInUse")
})
