import { type RunUpdate, Script } from "@viral/contracts"
import { Effect, Layer, ManagedRuntime, Option, Schema, Stream } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { AgentSession, type AgentTask } from "../agent-session/agent-session.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Projects } from "../projects/projects.ts"
import { PipelineStagesLive } from "../runs/pipeline-stages.ts"
import { RunManager } from "../runs/run-manager.ts"
import { RunStore } from "../runs/run-store.ts"
import { Sources } from "../sources/sources.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-script-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

const w = (word: string, s: number) => ({ w: word, s, e: s + 0.3 })
const TRANSCRIPT = {
  source: "candy.mp4",
  language: "en",
  segments: [
    { start: 100, end: 101, text: "It's like glue.", words: [w("It's", 100), w("like", 100.3), w("glue.", 100.6)] },
    { start: 200, end: 201, text: "It worked.", words: [w("It", 200), w("worked.", 200.3)] },
    { start: 300, end: 301, text: "So nasty.", words: [w("So", 300), w("nasty.", 300.3)] },
    { start: 400, end: 401, text: "Way too spicy.", words: [w("Way", 400), w("too", 400.3), w("spicy.", 400.6)] }
  ]
}

const narration = (n: number) => ({ _tag: "Narration", text: Array.from({ length: n }, () => "word").join(" ") })
const real = (quote: string, start: number) => ({ _tag: "Real", quote, start, end: start + 1 })

// The replayed agent: first an invented quote and too few reactions, then a fixed script.
const asked: Array<string> = []
const replay = AgentSession.replay((task: AgentTask<Schema.Top>) => {
  asked.push(task.message)
  return asked.length === 1
    ? { headline: ["THIS CANDY", "HITS EVERY TASTE"], beats: [narration(70), real("it tastes amazing", 150)] }
    : {
      headline: ["THIS CANDY", "HITS EVERY TASTE"],
      beats: [narration(70), real("it's like glue", 99), real("it worked", 199), real("way too spicy", 398), real("so nasty", 301)]
    }
})

const runtime = () =>
  ManagedRuntime.make(
    RunManager.layer.pipe(
      Layer.provideMerge(PipelineStagesLive),
      Layer.provideMerge(Layer.mergeAll(RunStore.layer, Artifacts.layer, Sources.layer, Projects.layer, replay))
    )
  )

test("the script stage fixes rejected scripts, snaps real lines, and waits for approval", async () => {
  const rt = runtime()
  const project = await rt.runPromise(Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "owned", rightsNote: null })
    // the source run's transcript, as if it had run
    const artifacts = yield* Artifacts
    const slot = yield* artifacts.allocate({ _tag: "Source", id: source.id }, "transcript")
    writeFileSync(join(slot.dir, "transcript.json"), JSON.stringify(TRANSCRIPT))
    yield* artifacts.record(slot, { data: null, path: join(slot.relDir, "transcript.json") })
    return yield* (yield* Projects).create({
      sourceId: source.id,
      title: "Every taste",
      approach: "claim-interleaved",
      presetId: null,
      musicTrackId: null
    })
  }))

  const updates = await rt.runPromise(Effect.gen(function*() {
    const runs = yield* RunManager
    const run = yield* runs.start({ _tag: "Project", id: project.id }, null)
    const seen = [...yield* runs.subscribe(run.id, 0).pipe(
      Stream.takeUntil((u: RunUpdate) => u._tag === "Event" && u.event._tag === "RequestRaised"),
      Stream.runCollect
    )]
    const raised = seen.findLast((u) => u._tag === "Event" && u.event._tag === "RequestRaised")
    assert.ok(raised?._tag === "Event" && raised.event._tag === "RequestRaised")
    yield* runs.respond(raised.event.request.id, { _tag: "Approve" })

    return [...seen, ...yield* runs.subscribe(run.id, 0).pipe(
      Stream.takeUntil((u: RunUpdate) => u._tag === "Event" && u.event._tag === "RunFinished"),
      Stream.runCollect
    )]
  }))

  assert.equal(asked.length, 2, "the agent was asked once and then to fix")
  assert.match(asked[1]!, /isn't in the transcript near 150\.0s/)
  assert.match(asked[1]!, /there are 1 real lines; this approach needs 4–9/)
  const finished = updates.findLast((u) => u._tag === "Event" && u.event._tag === "RunFinished")
  assert.ok(finished?._tag === "Event" && finished.event._tag === "RunFinished" && finished.event.run.status === "completed")

  const script = await rt.runPromise(Effect.gen(function*() {
    const artifact = Option.getOrThrow(yield* (yield* Artifacts).latest({ _tag: "Project", id: project.id }, "script"))
    return yield* Schema.decodeUnknownEffect(Script)(artifact.data)
  }))
  assert.deepEqual(script.beats[1], { _tag: "Real", quote: "It's like glue.", start: 99.95, end: 101.05 }, "snapped to the transcript")
  await rt.dispose()
})
