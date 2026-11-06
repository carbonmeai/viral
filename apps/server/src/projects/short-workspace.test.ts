import type { Script } from "@viral/contracts"
import { Effect, Layer, ManagedRuntime } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Artifacts } from "../artifacts/artifacts.ts"
import { RunStore } from "../runs/run-store.ts"
import { Sources } from "../sources/sources.ts"
import { Projects } from "./projects.ts"
import { ShortWorkspaces } from "./short-workspace.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-workspace-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

const script: Script = {
  headline: ["ONE CANDY", "EVERY TASTE"],
  beats: [{ _tag: "Narration", text: "This guy made a candy." }, { _tag: "Real", quote: "It worked.", start: 200, end: 201 }]
}

test("a short's workspace gathers its style, voice, run, waiting gate and what the run has made", async () => {
  const rt = ManagedRuntime.make(Layer.mergeAll(ShortWorkspaces.layer, Sources.layer, Projects.layer, Artifacts.layer, RunStore.layer))
  const { fresh, made } = await rt.runPromise(Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "owned", rightsNote: null })
    const artifacts = yield* Artifacts
    const video = yield* artifacts.allocate({ _tag: "Source", id: source.id }, "source-video")
    yield* artifacts.record(video, { data: null, path: join(video.relDir, "source.mp4") })
    const project = yield* (yield* Projects).create({ sourceId: source.id, title: "Every taste", approach: "claim-interleaved", presetId: null, musicTrackId: null })
    const workspaces = yield* ShortWorkspaces
    const fresh = yield* workspaces.get(project.id)

    const owner = { _tag: "Project", id: project.id } as const
    const store = yield* RunStore
    const run = yield* store.createRun(owner, null)
    const stage = yield* store.createStageRun(run.id, "script", 1, "waiting")
    const scriptSlot = yield* artifacts.allocate(owner, "script")
    yield* artifacts.record(scriptSlot, { data: script, path: null, stageRunId: stage.id })
    yield* store.createRequest(stage, "Approve the script?", { _tag: "ScriptGate", script, narrationWords: 5 })

    const vo = yield* artifacts.allocate(owner, "voiceover")
    yield* artifacts.record(vo, {
      data: { voiceId: "v", model: "eleven_v4", text: "x", characters: 20, rawPace: 2.7, atempo: 1.16, pace: 3.2, durationS: 2 },
      path: join(vo.relDir, "vo.wav")
    })
    const tx = yield* artifacts.allocate(owner, "voiceover-transcript")
    writeFileSync(join(tx.dir, "transcript.json"), JSON.stringify({
      source: "vo.wav",
      language: "en",
      segments: [{ start: 0, end: 1, text: "This guy", words: [{ w: "This", s: 0, e: 0.3 }, { w: "guy", s: 0.3, e: 0.6 }] }]
    }))
    yield* artifacts.record(tx, { data: null, path: join(tx.relDir, "transcript.json") })
    // an old shot plan that no longer decodes is left out instead of breaking the editor
    yield* artifacts.record(yield* artifacts.allocate(owner, "shot-plan"), { data: { shots: "old" }, path: null })
    return { fresh, made: yield* workspaces.get(project.id) }
  }))

  assert.equal(fresh.run, null)
  assert.equal(fresh.pending, null)
  assert.equal(fresh.script, null)
  assert.equal(fresh.voiceId, fresh.preset.config.voice.voiceId, "the style's voice when the short has none")
  assert.deepEqual(fresh.scriptLimits, { narrationWords: [60, 100], reals: [4, 9], realsOnlyAtEnd: false })
  assert.match(fresh.sourceVideo ?? "", /source-video\/v1\/source\.mp4$/)

  assert.equal(made.run?.status, "running")
  assert.deepEqual(made.stages.map((s) => `${s.stage}:${s.status}`), ["script:waiting"])
  assert.equal(made.pending?.payload?._tag, "ScriptGate")
  assert.deepEqual(made.script?.script.headline, ["ONE CANDY", "EVERY TASTE"])
  assert.equal(made.voiceover?.voiceover.atempo, 1.16)
  assert.match(made.voiceover?.path ?? "", /voiceover\/v1\/vo\.wav$/)
  assert.deepEqual(made.voiceover?.words.map((w) => w.w), ["This", "guy"])
  assert.equal(made.shotPlan, null)
  await rt.dispose()
})
