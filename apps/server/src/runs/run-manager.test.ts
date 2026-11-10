import type { RunOwner, RunUpdate } from "@viral/contracts"
import { Effect, Layer, ManagedRuntime, Option, Schedule, Stream } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Sources } from "../sources/sources.ts"
import { VideoSets } from "../video-sets/video-sets.ts"
import { RunManager } from "./run-manager.ts"
import { RunStore } from "./run-store.ts"
import { type Prerequisite, type StageContext, type StageDefinition, StageFailure, StageRegistry } from "./stages.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-runs-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

// Fake stages: "source" records an artifact; "transcribe" is gated and remembers each call's note.
const calls = { source: 0, transcribe: [] as Array<string | null> }
// the session each transcribe attempt was asked to resume
const sessions: Array<string | null> = []
// the third, review stage is only in the runs of the test that needs it
const withReview = { on: false }
// a video set's run: what it needs first, and its one stage
const setNeeds: { current: ReadonlyArray<Prerequisite> } = { current: [] }
// videos whose "source" stage fails, by owner id (a blocked download)
const failingSources = new Set<string>()

const fakeStages = Layer.effect(StageRegistry, Effect.gen(function*() {
  const artifacts = yield* Artifacts
  const produce = (ctx: StageContext, kind: "source-video" | "transcript", data: unknown) =>
    Effect.gen(function*() {
      const slot = yield* artifacts.allocate(ctx.owner, kind)
      yield* artifacts.record(slot, { data, path: null, stageRunId: ctx.stageRunId })
    })
  const stages: ReadonlyArray<StageDefinition> = [
    {
      name: "source",
      artifact: "source-video",
      gate: null,
      run: (ctx) =>
        failingSources.has(ctx.owner.id)
          ? Effect.fail(new StageFailure({ stage: "source", code: "blocked", message: "YouTube refused the download twice (403)." }))
          : Effect.sync(() => void calls.source++).pipe(Effect.andThen(produce(ctx, "source-video", { ok: true })))
    },
    {
      name: "transcribe",
      artifact: "transcript",
      gate: "Approve the transcript?",
      run: (ctx) =>
        Effect.sync(() => void calls.transcribe.push(ctx.note)).pipe(
          Effect.andThen(Effect.suspend(() => ctx.recordSession(`session-${calls.transcribe.length}`))),
          Effect.andThen(Effect.sync(() => void sessions.push(ctx.resumeSession))),
          Effect.andThen(ctx.progress(50, "halfway")),
          Effect.andThen(produce(ctx, "transcript", { text: ctx.note === null ? "first" : `redone: ${ctx.note}` }))
        ),
      applyEdit: (ctx, artifact) => produce(ctx, "transcript", artifact)
    }
  ]
  // a gated review stage that can't act on a note itself, so it sends rejections back to transcribe
  const review: StageDefinition = {
    name: "ads",
    artifact: "ad-ranges",
    gate: "Approve the review?",
    rejectTo: "transcribe",
    run: (ctx) => Effect.gen(function*() {
      const slot = yield* artifacts.allocate(ctx.owner, "ad-ranges")
      yield* artifacts.record(slot, { data: { ranges: [] }, path: null, stageRunId: ctx.stageRunId })
    })
  }
  const setStory: StageDefinition = {
    name: "set-story",
    artifact: "set-story",
    gate: null,
    run: (ctx) => Effect.gen(function*() {
      const slot = yield* artifacts.allocate(ctx.owner, "set-story")
      yield* artifacts.record(slot, { data: { proposals: [] }, path: null, stageRunId: ctx.stageRunId })
    })
  }
  return StageRegistry.of({
    stagesFor: (owner) => Effect.succeed(owner._tag === "Set" ? [setStory] : withReview.on ? [...stages, review] : stages),
    prerequisites: (owner) => Effect.succeed(owner._tag === "Set" ? setNeeds.current : [])
  })
}))

const appLayer = () =>
  RunManager.layer.pipe(
    Layer.provideMerge(fakeStages),
    Layer.provideMerge(Layer.mergeAll(RunStore.layer, Artifacts.layer, Sources.layer, VideoSets.layer))
  )

// One "server process": a long-lived runtime over the shared database.
const boot = () => ManagedRuntime.make(appLayer())
type Runtime = ReturnType<typeof boot>

const createSource = (rt: Runtime) =>
  rt.runPromise(Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "owned", rightsNote: null })
    return { _tag: "Source", id: source.id } as RunOwner
  }))

// Follows a run until it's waiting at a gate or finished; returns everything seen.
const until = (rt: Runtime, runId: Parameters<RunManager["Service"]["subscribe"]>[0], stop: (u: RunUpdate) => boolean) =>
  rt.runPromise(Effect.gen(function*() {
    const manager = yield* RunManager
    const seen = yield* manager.subscribe(runId, 0).pipe(
      Stream.takeUntil(stop),
      Stream.runCollect
    )
    return [...seen]
  }))

const raised = (u: RunUpdate) => u._tag === "Event" && u.event._tag === "RequestRaised"
const finished = (u: RunUpdate) => u._tag === "Event" && u.event._tag === "RunFinished"
const requestOf = (updates: ReadonlyArray<RunUpdate>) => {
  const event = updates.findLast(raised)
  assert.ok(event?._tag === "Event" && event.event._tag === "RequestRaised")
  return event.event.request
}
const stageStatuses = (rt: Runtime, runId: Parameters<RunManager["Service"]["subscribe"]>[0]) =>
  rt.runPromise(Effect.gen(function*() {
    return (yield* (yield* RunStore).listStageRuns(runId)).map((s) => `${s.stage}:${s.status}`)
  }))
const respond = (rt: Runtime, requestId: ReturnType<typeof requestOf>["id"], response: Parameters<RunManager["Service"]["respond"]>[1]) =>
  rt.runPromise(Effect.gen(function*() {
    return yield* (yield* RunManager).respond(requestId, response)
  }))
const start = (rt: Runtime, owner: RunOwner, from: "source" | "transcribe" | null = null) =>
  rt.runPromise(Effect.gen(function*() {
    return yield* (yield* RunManager).start(owner, from)
  }))
const latestTranscript = (rt: Runtime, owner: RunOwner) =>
  rt.runPromise(Effect.gen(function*() {
    return Option.getOrThrow(yield* (yield* Artifacts).latest(owner, "transcript"))
  }))

test("a gated run waits for approval, then later runs reuse approved work", async () => {
  const rt = boot()
  const owner = await createSource(rt)
  const run = await start(rt, owner)
  const atGate = await until(rt, run.id, raised)
  assert.ok(atGate.some((u) => u._tag === "Progress" && u.pct === 50), "live progress reaches subscribers")
  const shown = requestOf(atGate).payload
  assert.ok(shown?._tag === "ArtifactGate" && shown.artifact.kind === "transcript", "a stage without a view shows its artifact")
  await respond(rt, requestOf(atGate).id, { _tag: "Approve" })
  const end = await until(rt, run.id, finished)
  const last = end.findLast(finished)
  assert.ok(last?._tag === "Event" && last.event._tag === "RunFinished" && last.event.run.status === "completed")
  assert.deepEqual(await stageStatuses(rt, run.id), ["source:succeeded", "transcribe:succeeded"])

  const again = await start(rt, owner)
  await until(rt, again.id, finished)
  assert.deepEqual(await stageStatuses(rt, again.id), ["source:reused", "transcribe:reused"])
  assert.equal(calls.source, 1, "approved work is never redone")
  await rt.dispose()
})

test("a gated stage's time stops at its gate, so time spent reviewing it isn't counted", async () => {
  const rt = boot()
  const owner = await createSource(rt)
  const run = await start(rt, owner)
  const atGate = await until(rt, run.id, raised)
  await rt.runPromise(Effect.sleep("400 millis"))
  await respond(rt, requestOf(atGate).id, { _tag: "Approve" })
  await until(rt, run.id, finished)
  const transcribe = await rt.runPromise(Effect.gen(function*() {
    return (yield* (yield* RunStore).listStageRuns(run.id)).find((s) => s.stage === "transcribe")
  }))
  assert.ok(transcribe?.durationMs !== null && transcribe?.durationMs !== undefined, "the time is recorded")
  assert.ok(transcribe.durationMs < 400, `the review isn't counted (${transcribe.durationMs}ms)`)
  await rt.dispose()
})

test("reject re-runs the stage with your note; edit records your version", async () => {
  const rt = boot()
  const owner = await createSource(rt)
  calls.transcribe.length = 0
  const run = await start(rt, owner)
  const first = requestOf(await until(rt, run.id, raised))
  await respond(rt, first.id, { _tag: "Reject", note: "too long" })
  // the same stage's second gate
  const second = await until(rt, run.id, (u) => raised(u) && u._tag === "Event" && u.event._tag === "RequestRaised" && u.event.request.id !== first.id)
  assert.deepEqual(calls.transcribe, [null, "too long"])
  assert.deepEqual(sessions.slice(-2), [null, "session-1"], "the re-run continues the rejected attempt's session")
  assert.deepEqual((await latestTranscript(rt, owner)).data, { text: "redone: too long" })

  await respond(rt, requestOf(second).id, { _tag: "Edit", artifact: { text: "my own words" } })
  await until(rt, run.id, finished)
  const transcript = await latestTranscript(rt, owner)
  assert.deepEqual(transcript.data, { text: "my own words" })
  assert.equal(transcript.version, 3)
  assert.deepEqual(await stageStatuses(rt, run.id), ["source:succeeded", "transcribe:failed", "transcribe:succeeded"])
  await rt.dispose()
})

test("cancelling at a gate cancels the run and its open request", async () => {
  const rt = boot()
  const owner = await createSource(rt)
  const run = await start(rt, owner)
  const request = requestOf(await until(rt, run.id, raised))
  assert.equal(await rt.runPromise(Effect.gen(function*() { return yield* (yield* RunManager).cancel(run.id) })), true)
  const end = await until(rt, run.id, finished)
  const last = end.findLast(finished)
  assert.ok(last?._tag === "Event" && last.event._tag === "RunFinished" && last.event.run.status === "cancelled")
  const stored = await rt.runPromise(Effect.gen(function*() { return yield* (yield* RunStore).getRequest(request.id) }))
  assert.equal(Option.getOrThrow(stored).status, "cancelled")
  await rt.dispose()
})

test("a restart at a gate interrupts the run; resuming asks again without redoing the stage", async () => {
  const first = boot()
  const owner = await createSource(first)
  calls.transcribe.length = 0
  const run = await start(first, owner)
  await until(first, run.id, raised)
  await first.dispose() // the server process dies while waiting

  const second = boot()
  const interrupted = await second.runPromise(Effect.gen(function*() { return yield* (yield* RunStore).getRun(run.id) }))
  assert.equal(Option.getOrThrow(interrupted).status, "interrupted")

  const resumed = await second.runPromise(Effect.gen(function*() { return yield* (yield* RunManager).resume(run.id) }))
  await respond(second, requestOf(await until(second, resumed.id, raised)).id, { _tag: "Approve" })
  await until(second, resumed.id, finished)
  assert.deepEqual(calls.transcribe, [null], "the transcript made before the restart is approved, not redone")
  assert.deepEqual(await stageStatuses(second, resumed.id), ["source:reused", "transcribe:succeeded"])

  // and it now counts as approved
  const later = await start(second, owner)
  await until(second, later.id, finished)
  assert.deepEqual(await stageStatuses(second, later.id), ["source:reused", "transcribe:reused"])
  await second.dispose()
})

test("--from re-runs that stage and everything after it", async () => {
  const rt = boot()
  const owner = await createSource(rt)
  const run = await start(rt, owner)
  await respond(rt, requestOf(await until(rt, run.id, raised)).id, { _tag: "Approve" })
  await until(rt, run.id, finished)

  const redo = await start(rt, owner, "transcribe")
  await respond(rt, requestOf(await until(rt, redo.id, raised)).id, { _tag: "Approve" })
  await until(rt, redo.id, finished)
  assert.deepEqual(await stageStatuses(rt, redo.id), ["source:reused", "transcribe:succeeded"])

  // a late subscriber catches up from the stored events
  const replay = await until(rt, redo.id, () => false)
  assert.equal(replay[0]?._tag, "Snapshot")
  assert.ok(replay.some(finished))
  await rt.dispose()
})

test("a redo from an approved stage with a note gives the stage the note and its last conversation", async () => {
  const rt = boot()
  const owner = await createSource(rt)
  calls.transcribe.length = 0
  const run = await start(rt, owner)
  await respond(rt, requestOf(await until(rt, run.id, raised)).id, { _tag: "Approve" })
  await until(rt, run.id, finished)
  const lastSession = sessions.at(-1) === null ? `session-${calls.transcribe.length}` : null

  const redo = await rt.runPromise(Effect.gen(function*() {
    return yield* (yield* RunManager).start(owner, "transcribe", { note: "shorter, please" })
  }))
  await respond(rt, requestOf(await until(rt, redo.id, raised)).id, { _tag: "Approve" })
  await until(rt, redo.id, finished)
  assert.equal(calls.transcribe.at(-1), "shorter, please")
  assert.equal(sessions.at(-1), lastSession, "the redo picks up the stage's last agent session")
  assert.deepEqual((await latestTranscript(rt, owner)).data, { text: "redone: shorter, please" })
  await rt.dispose()
})

test("an answer sent the instant a gate appears is never missed", async () => {
  const rt = boot()
  const owner = await createSource(rt)
  const status = await rt.runPromise(Effect.gen(function*() {
    const manager = yield* RunManager
    const run = yield* manager.start(owner, null)
    // answer from inside the stream, with no delay at all
    const seen = yield* manager.subscribe(run.id, 0).pipe(
      Stream.tap((u) =>
        u._tag === "Event" && u.event._tag === "RequestRaised"
          ? manager.respond(u.event.request.id, { _tag: "Approve" }).pipe(Effect.orDie)
          : Effect.void),
      Stream.takeUntil(finished),
      Stream.runCollect
    )
    const last = [...seen].findLast(finished)
    return last?._tag === "Event" && last.event._tag === "RunFinished" ? last.event.run.status : "never finished"
  }))
  assert.equal(status, "completed")
  await rt.dispose()
})

test("a rejection sent back re-runs the earlier stage with the note, in its own conversation", async () => {
  const rt = boot()
  withReview.on = true
  const owner = await createSource(rt)
  const run = await start(rt, owner)
  const answered = new Set<string>()
  // the next gate of `stage` this test hasn't answered yet
  const nextGate = async (stage: string) => {
    const updates = await until(rt, run.id, (u) =>
      u._tag === "Event" && u.event._tag === "RequestRaised" && u.event.request.stage === stage && !answered.has(u.event.request.id))
    const request = requestOf(updates)
    answered.add(request.id)
    return request
  }

  await respond(rt, (await nextGate("transcribe")).id, { _tag: "Approve" })
  const before = calls.transcribe.length
  // reject the review: it goes back to transcribe
  await respond(rt, (await nextGate("ads")).id, { _tag: "Reject", note: "fix the start" })
  await respond(rt, (await nextGate("transcribe")).id, { _tag: "Approve" })
  assert.equal(calls.transcribe.at(-1), "fix the start", "transcribe ran again with the note")
  assert.equal(sessions.at(-1), `session-${before}`, "and continued its earlier conversation")
  await respond(rt, (await nextGate("ads")).id, { _tag: "Approve" })
  await until(rt, run.id, finished)
  assert.deepEqual(await stageStatuses(rt, run.id), [
    "source:succeeded",
    "transcribe:succeeded",
    "ads:failed",
    "transcribe:succeeded",
    "ads:succeeded"
  ])
  withReview.on = false
  await rt.dispose()
})

test("a rejection can name an earlier stage to go back to", async () => {
  const rt = boot()
  withReview.on = true
  const owner = await createSource(rt)
  const run = await start(rt, owner)
  const answered = new Set<string>()
  const nextGate = async (stage: string) => {
    const updates = await until(rt, run.id, (u) =>
      u._tag === "Event" && u.event._tag === "RequestRaised" && u.event.request.stage === stage && !answered.has(u.event.request.id))
    const request = requestOf(updates)
    answered.add(request.id)
    return request
  }
  await respond(rt, (await nextGate("transcribe")).id, { _tag: "Approve" })
  const sourcesBefore = calls.source
  // the review sends back to transcribe by default; this note goes all the way back to the source
  await respond(rt, (await nextGate("ads")).id, { _tag: "Reject", note: "wrong video", to: "source" })
  await respond(rt, (await nextGate("transcribe")).id, { _tag: "Approve" })
  await respond(rt, (await nextGate("ads")).id, { _tag: "Approve" })
  await until(rt, run.id, finished)
  assert.equal(calls.source, sourcesBefore + 1, "the source stage ran again")
  assert.deepEqual((await stageStatuses(rt, run.id)).slice(2), ["ads:failed", "source:succeeded", "transcribe:succeeded", "ads:succeeded"])
  withReview.on = false
  await rt.dispose()
})

const createSet = (rt: Runtime, videos: ReadonlyArray<RunOwner>) =>
  rt.runPromise(Effect.gen(function*() {
    const ids = videos.flatMap((v) => v._tag === "Source" ? [v.id] : [])
    const set = yield* (yield* VideoSets).create({ sourceIds: ids, brief: "why" })
    return { _tag: "Set", id: set.id } as RunOwner
  }))
const runsOf = (rt: Runtime, owner: RunOwner) => rt.runPromise(Effect.gen(function*() {
  return yield* (yield* RunStore).listRuns(owner)
}))
// the first run of an owner, once another run has started it
const firstRun = (rt: Runtime, owner: RunOwner) => rt.runPromise(Effect.gen(function*() {
  const store = yield* RunStore
  const runs = yield* store.listRuns(owner).pipe(
    Effect.repeat({ schedule: Schedule.spaced("10 millis"), until: (runs) => runs.length > 0 })
  )
  return runs[0]!
}))

test("a set run joins a video's run already going, starts one for a video that needs it, then runs its own stages", async () => {
  const rt = boot()
  const [going, fresh] = [await createSource(rt), await createSource(rt)]
  setNeeds.current = [going, fresh].map((owner, i) => ({ owner, through: "transcribe" as const, label: `V${i + 1}` }))
  const set = await createSet(rt, [going, fresh])
  const goingRun = await start(rt, going)
  requestOf(await until(rt, goingRun.id, raised))
  const setRun = await start(rt, set)

  // both videos wait at their transcript gate: the one already going, and the run the set started
  const freshRun = await firstRun(rt, fresh)
  await respond(rt, requestOf(await until(rt, goingRun.id, raised)).id, { _tag: "Approve" })
  await respond(rt, requestOf(await until(rt, freshRun.id, raised)).id, { _tag: "Approve" })
  const done = await until(rt, setRun.id, finished)
  const end = done.findLast(finished)
  assert.ok(end?._tag === "Event" && end.event._tag === "RunFinished")
  assert.equal(end.event.run.status, "completed", end.event.run.error ?? "")
  assert.deepEqual(await stageStatuses(rt, setRun.id), ["set-story:succeeded"])
  assert.equal((await runsOf(rt, going)).length, 1, "the run already going was joined, not repeated")
  assert.equal((await runsOf(rt, fresh)).length, 1)

  // read already: a second set run starts no video runs
  const again = await start(rt, set)
  await until(rt, again.id, finished)
  assert.equal((await runsOf(rt, fresh)).length, 1)
  setNeeds.current = []
  await rt.dispose()
})

test("cancelling a set run cancels the video runs it started", async () => {
  const rt = boot()
  const video = await createSource(rt)
  const other = await createSource(rt)
  setNeeds.current = [{ owner: video, through: "transcribe", label: "V1" }]
  const set = await createSet(rt, [video, other])
  const setRun = await start(rt, set)
  const child = await firstRun(rt, video)
  requestOf(await until(rt, child.id, raised))
  await rt.runPromise(Effect.gen(function*() {
    return yield* (yield* RunManager).cancel(setRun.id)
  }))
  const childEnd = (await until(rt, child.id, finished)).findLast(finished)
  assert.ok(childEnd?._tag === "Event" && childEnd.event._tag === "RunFinished")
  assert.equal(childEnd.event.run.status, "cancelled")
  const setEnd = (await until(rt, setRun.id, finished)).findLast(finished)
  assert.ok(setEnd?._tag === "Event" && setEnd.event._tag === "RunFinished")
  assert.equal(setEnd.event.run.status, "cancelled")
  setNeeds.current = []
  await rt.dispose()
})

test("one video that can't be read doesn't stop the set's other videos; the set run fails after them", async () => {
  const rt = boot()
  const [blocked, fine] = [await createSource(rt), await createSource(rt)]
  failingSources.add(blocked.id)
  setNeeds.current = [blocked, fine].map((owner, i) => ({ owner, through: "source" as const, label: `V${i + 1}` }))
  const set = await createSet(rt, [blocked, fine])
  const setRun = await start(rt, set)
  const setEnd = (await until(rt, setRun.id, finished)).findLast(finished)
  assert.ok(setEnd?._tag === "Event" && setEnd.event._tag === "RunFinished")
  assert.equal(setEnd.event.run.status, "failed")
  assert.match(setEnd.event.run.error ?? "", /V1 couldn't be read: source \(blocked\)/)
  assert.deepEqual((await runsOf(rt, blocked)).map((r) => r.status), ["failed"])
  assert.deepEqual((await runsOf(rt, fine)).map((r) => r.status), ["completed"], "the other video was still read")
  failingSources.clear()
  setNeeds.current = []
  await rt.dispose()
})
