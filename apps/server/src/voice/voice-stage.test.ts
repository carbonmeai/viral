import { type RunUpdate, Voiceover } from "@viral/contracts"
import { Effect, Layer, ManagedRuntime, Option, Schema, Stream } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { AgentSession } from "../agent-session/agent-session.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Projects } from "../projects/projects.ts"
import { PipelineStagesLive } from "../runs/pipeline-stages.ts"
import { RunManager } from "../runs/run-manager.ts"
import { RunStore } from "../runs/run-store.ts"
import { Sources } from "../sources/sources.ts"
import { Transcriber } from "../transcribe/transcriber.ts"
import { ElevenLabs, type SpeechRequest } from "./eleven-labs.ts"

let home: string
let take: Uint8Array
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-voice-"))
  process.env.VIRAL_HOME = home
  // the "take": a second of silence, then five seconds of tone standing in for speech
  const mp3 = join(home, "take.mp3")
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=f=220:d=5", "-af", "adelay=1000", mp3])
  take = readFileSync(mp3)
})
after(() => rmSync(home, { recursive: true, force: true }))

const durationOf = (file: string) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString())

// 13 words spread over the file as heard: 2.6 words/sec for the 5s trimmed take
const wordsOver = (span: number) => Array.from({ length: 13 }, (_, i) => ({ w: "word", s: (i * span) / 13, e: ((i + 1) * span) / 13 }))
const transcribed: Array<string> = []
const transcriber = Transcriber.replay((media) => {
  transcribed.push(media)
  return { source: media, language: "en", segments: [{ start: 0, end: 5, text: "words", words: wordsOver(durationOf(media)) }] }
})
const spoken: Array<SpeechRequest> = []
const eleven = ElevenLabs.replay((request) => {
  spoken.push(request)
  return take
})

const runtime = () =>
  ManagedRuntime.make(
    RunManager.layer.pipe(
      Layer.provideMerge(PipelineStagesLive),
      Layer.provideMerge(Layer.mergeAll(
        RunStore.layer,
        Artifacts.layer,
        Sources.layer,
        Projects.layer,
        AgentSession.replay(() => null),
        eleven,
        transcriber
      ))
    )
  )

test("the voice stage speaks the narration in one take, paces it, and waits for approval", async () => {
  const rt = runtime()
  const project = await rt.runPromise(Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "owned", rightsNote: null })
    const projects = yield* Projects
    const project = yield* projects.create({
      sourceId: source.id,
      title: "Every taste",
      approach: "claim-interleaved",
      presetId: null,
      musicTrackId: null
    })
    // an approved script, and a voice picked for this short
    const artifacts = yield* Artifacts
    yield* artifacts.record(yield* artifacts.allocate({ _tag: "Project", id: project.id }, "script"), {
      data: {
        headline: null,
        beats: [
          { _tag: "Narration", text: "This guy made a candy." },
          { _tag: "Real", quote: "It worked.", start: 200, end: 201 },
          { _tag: "Narration", text: " It hits every taste. " }
        ]
      },
      path: null
    })
    return yield* projects.setVoice(project.id, "voice-123")
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
    assert.equal(raised.event.request.title, "Approve the voiceover?")
    yield* runs.respond(raised.event.request.id, { _tag: "Approve" })
    return [...yield* runs.subscribe(run.id, 0).pipe(
      Stream.takeUntil((u: RunUpdate) => u._tag === "Event" && u.event._tag === "RunFinished"),
      Stream.runCollect
    )]
  }))
  const finished = updates.findLast((u) => u._tag === "Event" && u.event._tag === "RunFinished")
  assert.ok(finished?._tag === "Event" && finished.event._tag === "RunFinished")
  assert.equal(finished.event.run.status, "completed", finished.event.run.error ?? "")

  assert.deepEqual(spoken, [{ voiceId: "voice-123", model: "eleven_v4", text: "This guy made a candy. It hits every taste." }])
  assert.equal(transcribed.length, 2, "the trimmed take, then the paced one")

  const { voiceover, file, transcript } = await rt.runPromise(Effect.gen(function*() {
    const artifacts = yield* Artifacts
    const owner = { _tag: "Project", id: project.id } as const
    const artifact = Option.getOrThrow(yield* artifacts.latest(owner, "voiceover"))
    return {
      voiceover: yield* Schema.decodeUnknownEffect(Voiceover)(artifact.data),
      file: artifacts.resolve(artifact),
      transcript: Option.getOrThrow(yield* artifacts.latest(owner, "voiceover-transcript"))
    }
  }))
  assert.ok(Math.abs(voiceover.rawPace - 2.6) < 0.05, `raw pace ${voiceover.rawPace}: the leading silence was trimmed`)
  assert.equal(voiceover.atempo, 1.23)
  assert.ok(Math.abs(voiceover.pace - 3.2) < 0.05, `paced to ${voiceover.pace}`)
  assert.ok(file !== null && Math.abs(durationOf(file) - 5 / 1.23) < 0.1)
  assert.equal(voiceover.characters, 43)
  assert.match(transcript.path ?? "", /transcript\.json$/)
  await rt.dispose()
})
