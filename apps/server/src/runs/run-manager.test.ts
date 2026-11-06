import type { RunOwner, RunUpdate } from "@viral/contracts"
import { Effect, Layer, ManagedRuntime, Option, Stream } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Sources } from "../sources/sources.ts"
import { RunManager } from "./run-manager.ts"
import { RunStore } from "./run-store.ts"
import { type StageContext, type StageDefinition, StageRegistry } from "./stages.ts"

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
      run: (ctx) => Effect.sync(() => void calls.source++).pipe(Effect.andThen(produce(ctx, "source-video", { ok: true })))
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
  return StageRegistry.of({ stagesFor: () => Effect.succeed(stages) })
}))

const appLayer = () =>
  RunManager.layer.pipe(
    Layer.provideMerge(fakeStages),
    Layer.provideMerge(Layer.mergeAll(RunStore.layer, Artifacts.layer, Sources.layer))
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
