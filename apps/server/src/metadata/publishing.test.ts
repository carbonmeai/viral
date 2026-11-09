import { NodeServices } from "@effect/platform-node"
import { type ArtifactKind, type Project, PublishedShort, RenderedShort, type RunUpdate, type ShortMetadata } from "@viral/contracts"
import { Effect, FileSystem, Layer, ManagedRuntime, Option, Path, Schema, Stream } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ViralHome } from "../home/viral-home.ts"
import { Presets } from "../presets/presets.ts"
import { Projects } from "../projects/projects.ts"
import { RunManager } from "../runs/run-manager.ts"
import { RunStore } from "../runs/run-store.ts"
import { type StageDefinition, StageRegistry } from "../runs/stages.ts"
import { Settings } from "../settings/settings.ts"
import { Sources } from "../sources/sources.ts"
import { writePublished } from "./publish-files.ts"
import { agentPost, checkPost } from "./publish-rules.ts"
import { Publishing } from "./publishing.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-publishing-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

const METADATA: ShortMetadata = {
  title: "He Put 7 Tastes Into 1 Candy",
  alternates: ["One Candy, 7 Tastes at Once", "The Candy That Hits Every Taste"],
  description: "This creator packed seven tastes into one candy.",
  hashtags: ["#shorts", "#candy", "#science"]
}

type Owner = { readonly _tag: "Project"; readonly id: Project["id"] }

// Records a render (an "mp4" holding `content`) and the plan it followed, drawing `credit` on the video.
const recordRender = (owner: Owner, content: string, credit: string | null) =>
  Effect.gen(function*() {
    const artifacts = yield* Artifacts
    const plan = yield* artifacts.allocate(owner, "narrated-plan")
    yield* artifacts.record(plan, { data: credit === null ? {} : { credit }, path: null })
    const slot = yield* artifacts.allocate(owner, "render")
    writeFileSync(join(slot.dir, "short.mp4"), content)
    writeFileSync(join(slot.dir, "short.srt"), "1\n00:00:00,000 --> 00:00:01,000\nhi\n")
    return yield* artifacts.record(slot, {
      data: { video: join(slot.dir, "short.mp4"), captions: join(slot.dir, "short.srt"), durationS: 30, shots: 4, checkSheet: null },
      path: join(slot.relDir, "short.mp4")
    })
  })

// A short published as the metadata stage publishes it.
const publishedShort = (presetName: string | null, thumbnail = true) =>
  Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "licensed", rightsNote: null })
    yield* (yield* Sources).setDetails(source.id, "Candy", "NileBlue")
    const presets = yield* Presets
    const preset = presetName === null ? null : (yield* presets.list).find((p) => p.name === presetName)!
    const project = yield* (yield* Projects).create({
      sourceIds: [source.id],
      title: "Candy",
      approach: "question-recap",
      presetId: preset?.id ?? null,
      musicTrackId: null
    })
    const owner = { _tag: "Project", id: project.id } as const
    const render = yield* recordRender(owner, "render one", preset?.config.credit ? "Video: NileBlue" : null)
    const artifacts = yield* Artifacts
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const { published } = yield* writePublished({ artifacts, fs, path }, {
      slug: project.slug,
      rendersDir: (yield* ViralHome).renders,
      render: yield* Schema.decodeUnknownEffect(RenderedShort)(render.data).pipe(Effect.orDie),
      renderArtifact: render,
      metadata: METADATA,
      post: agentPost(METADATA),
      credit: "NileBlue",
      approach: project.approach,
      style: "Viral recap",
      previous: null
    })
    yield* artifacts.record(yield* artifacts.allocate(owner, "metadata"), { data: published, path: null })
    if (thumbnail) yield* artifacts.record(yield* artifacts.allocate(owner, "thumbnail"), { data: {}, path: null })
    return { project, source, owner }
  })

const latestPublished = (owner: Owner) =>
  Effect.flatMap(Artifacts, (a) => a.latest(owner, "metadata")).pipe(
    Effect.map((a) => Schema.decodeUnknownSync(PublishedShort)(Option.getOrThrow(a).data))
  )

// The short's stages from assemble: assemble counts its runs, render records a new "mp4" drawing the new credit
// and waits for approval; metadata and thumbnail would be agent work, so they fail if they ever run.
const registry = (kinds: { assembled: number }) =>
  Layer.effect(StageRegistry, Effect.gen(function*() {
    const artifacts = yield* Artifacts
    const agent = (name: "metadata" | "thumbnail", artifact: ArtifactKind): StageDefinition => ({
      name,
      artifact,
      gate: null,
      run: () => Effect.die(`the ${name} agent ran`)
    })
    const stages: ReadonlyArray<StageDefinition> = [
      { name: "assemble", artifact: "narrated-plan", gate: null, run: () => Effect.sync(() => void kinds.assembled++) },
      {
        name: "render",
        artifact: "render",
        gate: "Approve the render?",
        run: (ctx) =>
          recordRender(ctx.owner as Owner, "render two", "Video: Mark Rober").pipe(Effect.provideService(Artifacts, artifacts), Effect.asVoid)
      },
      agent("metadata", "metadata"),
      agent("thumbnail", "thumbnail")
    ]
    return StageRegistry.of({ stagesFor: () => Effect.succeed(stages) })
  })).pipe(Layer.provide(Artifacts.layer))

const runtime = (kinds: { assembled: number }) =>
  ManagedRuntime.make(Layer.mergeAll(
    Publishing.layer.pipe(
      Layer.provideMerge(RunManager.layer),
      Layer.provide([registry(kinds), RunStore.layer, Artifacts.layer])
    ),
    RunStore.layer,
    Sources.layer,
    Projects.layer,
    Presets.layer,
    Artifacts.layer,
    Settings.layer,
    ViralHome.layer,
    NodeServices.layer
  ))

const notes = (slug: string) => readFileSync(join(home, "renders", `${slug}.md`), "utf8")

test("post text you type is checked: a title of 1–100 characters, a description, # hashtags", () => {
  const ok = checkPost({ title: "  One Candy,   7 Tastes ", description: " Seven tastes. ", hashtags: ["#shorts", "candy", "#candy", " "] })
  assert.deepEqual(ok.problems, [])
  assert.deepEqual(ok.value, { title: "One Candy, 7 Tastes", description: "Seven tastes.", hashtags: ["#shorts", "#candy"] })
  const bad = checkPost({ title: "x".repeat(101), description: "", hashtags: ["#two words", "#ok!"] }).problems.join("\n")
  assert.match(bad, /the title is 101 characters; YouTube allows 100/)
  assert.match(bad, /the description is empty/)
  assert.match(bad, /no spaces or punctuation: #two words, #ok!/)
  assert.match(checkPost({ title: " ", description: "d", hashtags: [] }).problems.join(), /the title is empty/)
})

test("the chosen title is saved per short and publishing again writes it into the post notes", async () => {
  const rt = runtime({ assembled: 0 })
  const r = await rt.runPromise(Effect.gen(function*() {
    const publishing = yield* Publishing
    const { project, owner } = yield* publishedShort(null)
    const fresh = yield* publishing.status(project.id)
    const chosen = yield* publishing.setPost(project.id, { ...agentPost(METADATA), title: METADATA.alternates[0]! })
    const tooLong = yield* Effect.flip(publishing.setPost(project.id, { ...agentPost(METADATA), title: "x".repeat(101) }))
    const again = yield* publishing.publishAgain(project.id)
    const after = yield* publishing.status(project.id)
    const recorded = yield* latestPublished(owner)
    const reset = yield* publishing.setPost(project.id, null)
    return { project, fresh, chosen, tooLong, again, after, recorded, reset }
  }))
  assert.deepEqual(r.fresh.changes, [], "the files match what was published")
  assert.equal(r.fresh.edited, false)
  assert.deepEqual(r.fresh.files, [`${r.project.slug}.mp4`, `${r.project.slug}.srt`, `${r.project.slug}.md`])
  assert.equal(r.chosen.post.title, "One Candy, 7 Tastes at Once")
  assert.deepEqual(r.chosen.changes, ["title"])
  assert.equal(r.chosen.edited, true)
  assert.equal(r.tooLong._tag, "PostTextInvalid")
  assert.equal(r.again._tag, "Published")
  assert.deepEqual(r.after.changes, [], "nothing left to publish")
  assert.equal(r.after.post.title, "One Candy, 7 Tastes at Once", "the choice is kept")
  assert.equal(r.recorded.title, METADATA.title, "the agent's metadata is kept as it was")
  assert.equal(r.recorded.posted?.title, "One Candy, 7 Tastes at Once")
  const md = notes(r.project.slug)
  assert.match(md, /^# One Candy, 7 Tastes at Once\n/)
  assert.match(md, /## Title\n\nOne Candy, 7 Tastes at Once\n\nAlternates:\n- He Put 7 Tastes Into 1 Candy\n- The Candy That Hits Every Taste/)
  assert.deepEqual(r.reset.changes, ["title"], "back to the agent's title, which isn't in the files")
  await rt.dispose()
})

test("a new channel name changes the description's credit; a credit not drawn on the video needs no render", async () => {
  const rt = runtime({ assembled: 0 })
  const r = await rt.runPromise(Effect.gen(function*() {
    const publishing = yield* Publishing
    const { project, source } = yield* publishedShort(null)
    yield* (yield* Sources).setDetails(source.id, "Candy", "Mark Rober")
    const before = yield* publishing.status(project.id)
    const again = yield* publishing.publishAgain(project.id)
    return { project, before, again }
  }))
  assert.deepEqual(r.before.changes, ["credit"])
  assert.equal(r.before.rerender, false)
  assert.equal(r.before.credit, "Mark Rober")
  assert.equal(r.again._tag, "Published")
  assert.match(notes(r.project.slug), /Credit: Mark Rober\n/)
  await rt.dispose()
})

test("a credit drawn on the video re-renders it (assemble and render, no agents, no new thumbnail), then publishes the new mp4", async () => {
  const kinds = { assembled: 0 }
  const rt = runtime(kinds)
  const { project, before, run } = await rt.runPromise(Effect.gen(function*() {
    const publishing = yield* Publishing
    // no thumbnail yet: the re-render stops before making one
    const { project, source } = yield* publishedShort("Headline full-bleed", false)
    yield* (yield* Sources).setDetails(source.id, "Candy", "Mark Rober")
    const before = yield* publishing.status(project.id)
    const again = yield* publishing.publishAgain(project.id)
    assert.equal(again._tag, "Rendering")
    return { project, before, run: again._tag === "Rendering" ? again.run : null }
  }))
  assert.deepEqual(before.changes, ["credit", "video"])
  assert.equal(before.rerender, true)
  assert.equal(readFileSync(join(home, "renders", `${project.slug}.mp4`), "utf8"), "render one")

  const follow = (stop: (u: RunUpdate) => boolean) =>
    rt.runPromise(Effect.gen(function*() {
      return [...yield* (yield* RunManager).subscribe(run!.id, 0).pipe(Stream.takeUntil(stop), Stream.runCollect)]
    }))
  const atGate = await follow((u) => u._tag === "Event" && u.event._tag === "RequestRaised")
  const gate = atGate.findLast((u) => u._tag === "Event" && u.event._tag === "RequestRaised")
  assert.ok(gate?._tag === "Event" && gate.event._tag === "RequestRaised")
  const requestId = gate.event.request.id
  // while the render waits for approval, publishing again is refused
  const busy = await rt.runPromise(Effect.flip((Effect.flatMap(Publishing, (p) => p.publishAgain(project.id)))))
  assert.equal(busy._tag, "PublishUnavailable")
  await rt.runPromise(Effect.flatMap(RunManager, (m) => m.respond(requestId, { _tag: "Approve" })))
  await follow((u) => u._tag === "Event" && u.event._tag === "RunFinished")

  const { finished, stageRuns, after } = await rt.runPromise(Effect.gen(function*() {
    const store = yield* RunStore
    return {
      finished: Option.getOrThrow(yield* store.getRun(run!.id)),
      stageRuns: yield* store.listStageRuns(run!.id),
      after: yield* (yield* Publishing).status(project.id)
    }
  }))
  assert.equal(finished.status, "completed", finished.error ?? "")
  assert.deepEqual(stageRuns.map((s) => `${s.stage}:${s.status}`), [
    "assemble:succeeded",
    "render:succeeded",
    "metadata:reused"
  ])
  assert.equal(kinds.assembled, 1)
  assert.equal(readFileSync(join(home, "renders", `${project.slug}.mp4`), "utf8"), "render two", "the new render replaced the old file")
  assert.match(notes(project.slug), /Credit: Mark Rober\n/)
  assert.deepEqual(after.changes, [])
  await rt.dispose()
})
