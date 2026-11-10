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
import { ElevenLabs } from "../voice/eleven-labs.ts"
import { Transcriber } from "../transcribe/transcriber.ts"

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

// Runs that don't reach the voice stage never speak.
const NoVoice = Layer.mergeAll(ElevenLabs.replay(() => new Uint8Array()), Transcriber.layer)

const runtime = (agent: Layer.Layer<AgentSession> = replay) =>
  ManagedRuntime.make(
    RunManager.layer.pipe(
      Layer.provideMerge(PipelineStagesLive),
      Layer.provideMerge(Layer.mergeAll(RunStore.layer, Artifacts.layer, Sources.layer, Projects.layer, agent, NoVoice))
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
      sourceIds: [source.id],
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
    const payload = raised.event.request.payload
    assert.ok(payload?._tag === "ScriptGate" && payload.narrationWords === 70, "the gate shows the snapped script")
    yield* runs.respond(raised.event.request.id, { _tag: "Approve" })

    // the voice stage comes next; this test stops there
    const rest = [...yield* runs.subscribe(run.id, 0).pipe(
      Stream.takeUntil((u: RunUpdate) => u._tag === "Event" && u.event._tag === "StageStarted" && u.event.stageRun.stage === "voice"),
      Stream.runCollect
    )]
    yield* runs.cancel(run.id)
    return [...seen, ...rest]
  }))

  assert.equal(asked.length, 2, "the agent was asked once and then to fix")
  assert.match(asked[1]!, /isn't in the transcript near 150\.0s/)
  assert.match(asked[1]!, /there are 1 real lines; this approach needs 4–9/)
  const scriptDone = updates.findLast((u) => u._tag === "Event" && u.event._tag === "StageFinished" && u.event.stageRun.stage === "script")
  assert.ok(scriptDone?._tag === "Event" && scriptDone.event._tag === "StageFinished" && scriptDone.event.stageRun.status === "succeeded")

  const script = await rt.runPromise(Effect.gen(function*() {
    const artifact = Option.getOrThrow(yield* (yield* Artifacts).latest({ _tag: "Project", id: project.id }, "script"))
    return yield* Schema.decodeUnknownEffect(Script)(artifact.data)
  }))
  assert.deepEqual(script.beats[1], { _tag: "Real", quote: "It's like glue.", start: 99.95, end: 101.05 }, "snapped to the transcript")
  await rt.dispose()
})

// V2: a second video with its own lines and a sponsor read
const TRANSCRIPT_V2 = {
  source: "chemist.mp4",
  language: "en",
  segments: [
    { start: 5, end: 6, text: "Pure citric acid.", words: [w("Pure", 5), w("citric", 5.3), w("acid.", 5.6)] },
    { start: 50, end: 51, text: "Buy our gum.", words: [w("Buy", 50), w("our", 50.3), w("gum.", 50.6)] }
  ]
}

test("a short from two videos: the agent sees both, each real line is checked in its own video and stored with it", async () => {
  const briefs: Array<string> = []
  const tools: Array<ReadonlyArray<string>> = []
  const twoVideos = AgentSession.replay((task: AgentTask<Schema.Top>) => {
    briefs.push(task.message)
    tools.push((task.tools ?? []).map((t) => t.name))
    const base = [narration(70), real("it's like glue", 99), real("it worked", 199), real("way too spicy", 398)]
    return briefs.length === 1
      // V1's line said to be in V2, and V2's sponsor read
      ? { headline: null, beats: [...base, { ...real("so nasty", 300), video: 2 }, { ...real("buy our gum", 50), video: 2 }] }
      : { headline: null, beats: [...base, real("so nasty", 300), { ...real("pure citric acid", 5), video: 2 }] }
  })
  const rt = runtime(twoVideos)
  const project = await rt.runPromise(Effect.gen(function*() {
    const sources = yield* Sources
    const artifacts = yield* Artifacts
    const withTranscript = Effect.fn(function*(url: string, transcript: unknown, ads: ReadonlyArray<{ start: number; end: number }>) {
      const source = yield* sources.create({ origin: { _tag: "Url", url }, rights: "owned", rightsNote: null })
      const owner = { _tag: "Source", id: source.id } as const
      const slot = yield* artifacts.allocate(owner, "transcript")
      writeFileSync(join(slot.dir, "transcript.json"), JSON.stringify(transcript))
      yield* artifacts.record(slot, { data: null, path: join(slot.relDir, "transcript.json") })
      // the video's been read (a short's run reads its later videos first otherwise)
      for (const kind of ["source-video", "contact-sheet"] as const) {
        yield* artifacts.record(yield* artifacts.allocate(owner, kind), { data: null, path: "read" })
      }
      yield* artifacts.record(yield* artifacts.allocate(owner, "ad-ranges"), {
        data: { ranges: ads.map((a) => ({ ...a, kind: "sponsor", evidence: "x" })) },
        path: null
      })
      return source
    })
    const v1 = yield* withTranscript("https://youtu.be/a", TRANSCRIPT, [])
    const v2 = yield* withTranscript("https://youtu.be/b", TRANSCRIPT_V2, [{ start: 49, end: 55 }])
    return yield* (yield* Projects).create({
      sourceIds: [v1.id, v2.id],
      title: "Candy science",
      approach: "claim-interleaved",
      presetId: null,
      musicTrackId: null,
      brief: "The candy, then the chemist explains why it hurts."
    })
  }))

  await rt.runPromise(Effect.gen(function*() {
    const runs = yield* RunManager
    const run = yield* runs.start({ _tag: "Project", id: project.id }, null)
    yield* runs.subscribe(run.id, 0).pipe(
      Stream.takeUntil((u: RunUpdate) => u._tag === "Event" && u.event._tag === "RequestRaised"),
      Stream.runDrain
    )
    yield* runs.cancel(run.id)
  }))

  assert.equal(briefs.length, 2, "asked once, then to fix")
  assert.match(briefs[0]!, /V1 "/)
  assert.match(briefs[0]!, /V2 "/)
  assert.match(briefs[0]!, /\[V2 5\.0–6\.0\] Pure citric acid\./, "V2's lines are labelled with their video")
  assert.match(briefs[0]!, /Excluded ranges in V2.*49–55s/)
  assert.deepEqual(tools[0], ["tell_creator"], "short transcripts come whole, so no transcript tools")
  assert.match(briefs[1]!, /"so nasty" isn't in V2's transcript near 300\.0s/)
  assert.match(briefs[1]!, /"buy our gum" is inside an ad or sponsor read \(49–55s\)/)

  const script = await rt.runPromise(Effect.gen(function*() {
    const artifact = Option.getOrThrow(yield* (yield* Artifacts).latest({ _tag: "Project", id: project.id }, "script"))
    return yield* Schema.decodeUnknownEffect(Script)(artifact.data)
  }))
  const reals = script.beats.filter((b) => b._tag === "Real")
  assert.deepEqual(reals.at(-1), { _tag: "Real", quote: "Pure citric acid.", start: 4.95, end: 6.05, source: 1 }, "snapped in V2 and stored as position 1")
  assert.equal(reals[0] !== undefined && "source" in reals[0], false, "V1's lines are stored without a source")
  await rt.dispose()
})
