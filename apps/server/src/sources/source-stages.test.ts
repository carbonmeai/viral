import type { RunOwner, RunUpdate } from "@viral/contracts"
import { Effect, Layer, ManagedRuntime, Stream } from "effect"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { AgentSession } from "../agent-session/agent-session.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { PipelineStagesLive } from "../runs/pipeline-stages.ts"
import { RunManager } from "../runs/run-manager.ts"
import { RunStore } from "../runs/run-store.ts"
import { makeTestVideo } from "../testing/test-video.ts"
import { Sources } from "./sources.ts"
import { ElevenLabs } from "../voice/eleven-labs.ts"
import { Transcriber } from "../transcribe/transcriber.ts"

let work: string
let video: string
before(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "viral-source-run-")))
  process.env.VIRAL_HOME = join(work, "home")
  // transcription isn't exercised here (it needs a model or an API key); see transcriber.golden.ts
  video = join(work, "My Long Video.mp4")
  makeTestVideo(video, 12)
})
after(() => rmSync(work, { recursive: true, force: true }))

// Runs that don't reach the voice stage never speak.
const NoVoice = Layer.mergeAll(ElevenLabs.replay(() => new Uint8Array()), Transcriber.layer)

const runtime = () =>
  ManagedRuntime.make(
    RunManager.layer.pipe(
      Layer.provideMerge(PipelineStagesLive),
      Layer.provideMerge(Layer.mergeAll(RunStore.layer, Artifacts.layer, Sources.layer, AgentSession.replay(() => null), NoVoice))
    )
  )

test("a source run fetches the video and records its metadata", async () => {
  const rt = runtime()
  const source = await rt.runPromise(Effect.gen(function*() {
    return yield* (yield* Sources).create({ origin: { _tag: "File", path: video }, rights: "owned", rightsNote: null })
  }))
  const owner: RunOwner = { _tag: "Source", id: source.id }
  const updates = await rt.runPromise(Effect.gen(function*() {
    const runs = yield* RunManager
    const run = yield* runs.start(owner, null)
    // stop once transcription starts: the source stage is done by then
    return [...yield* runs.subscribe(run.id, 0).pipe(
      Stream.takeUntil((u: RunUpdate) =>
        u._tag === "Event" && u.event._tag === "StageStarted" && u.event.stageRun.stage === "transcribe"),
      Stream.runCollect
    )]
  }))
  assert.ok(updates.some((u) => u._tag === "Progress" && u.stage === "source"), "the fetch reports progress")

  const { row, video: fetched } = await rt.runPromise(Effect.gen(function*() {
    const row = yield* (yield* Sources).get(source.id)
    const latest = yield* (yield* Artifacts).latest(owner, "source-video")
    return { row, video: latest }
  }))
  assert.equal(row.title, "My Long Video")
  assert.ok(row.durationS !== null && Math.abs(row.durationS - 12) < 0.2)
  assert.equal(fetched._tag, "Some")
  const file = join(work, "home/sources", source.id, "source-video/v1/source.mp4")
  assert.ok(existsSync(file))
  assert.equal(statSync(file).ino, statSync(video).ino, "a local mp4 is hard-linked, not copied")
  await rt.dispose()
})
