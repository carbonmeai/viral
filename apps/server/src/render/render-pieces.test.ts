// A short from a video found by research (read from a 480p scan) renders from 1080p pieces of the seconds it plays,
// fetched through the fake yt-dlp. (When they can't be fetched: source-pieces.test.ts and render-footage.test.ts.)
// Replayed agents, no network, no paid runs.
import { type RunRequest, type RunUpdate, type SourceId } from "@viral/contracts"
import { Effect, Layer, ManagedRuntime, Stream } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { AgentSession } from "../agent-session/agent-session.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { Projects } from "../projects/projects.ts"
import { FAKE_YT_DLP } from "../research/testing/fake-youtube.ts"
import { PipelineStagesLive } from "../runs/pipeline-stages.ts"
import { RunManager } from "../runs/run-manager.ts"
import { RunStore } from "../runs/run-store.ts"
import { Sources } from "../sources/sources.ts"
import { Transcriber } from "../transcribe/transcriber.ts"
import { ElevenLabs } from "../voice/eleven-labs.ts"

let home: string
let log: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-render-pieces-"))
  log = join(home, "yt-dlp.log")
  process.env["VIRAL_HOME"] = home
  process.env["VIRAL_YT_DLP"] = FAKE_YT_DLP
  process.env["VIRAL_YT_RETRY_PAUSE_S"] = "0"
  process.env["FAKE_YT_LOG"] = log
})
after(() => {
  for (const name of ["VIRAL_YT_DLP", "VIRAL_YT_RETRY_PAUSE_S", "FAKE_YT_LOG", "FAKE_YT_SECTIONS_403"]) delete process.env[name]
  rmSync(home, { recursive: true, force: true })
})

const w = (word: string, s: number, e = s + 0.4) => ({ w: word, s, e })
const transcriptOf = (words: ReadonlyArray<{ w: string; s: number; e: number }>) => ({
  source: "x",
  language: "en",
  segments: [{ start: words[0]!.s, end: words.at(-1)!.e, text: words.map((x) => x.w).join(" "), words }]
})
const VO = ["This", "horse", "gave", "up.", "Not", "anymore."].map((word, i) => w(word, i * 0.3, i * 0.3 + 0.25))

const replay = AgentSession.replay((task) =>
  task.stage === "shots"
    ? { shots: [{ word: 0, src: 10, note: "before" }, { word: 2, src: 20, note: "the vet" }, { word: 4, src: 30, note: "after" }], markers: [], highlights: [] }
    : (() => {
      throw new Error(`no replay for ${task.stage}`)
    })()
)

const runtime = () =>
  ManagedRuntime.make(
    RunManager.layer.pipe(
      Layer.provideMerge(PipelineStagesLive),
      Layer.provideMerge(Layer.mergeAll(RunStore.layer, Artifacts.layer, Sources.layer, Projects.layer, replay, ElevenLabs.replay(() => new Uint8Array()), Transcriber.layer))
    )
  )
type Runtime = ReturnType<typeof runtime>

// A video found by research, already read: its 480p scan (a blue 60 s video here), transcript, and a narrated short
// of it with its script and voiceover.
const scannedShort = (rt: Runtime, videoId: string) =>
  rt.runPromise(Effect.gen(function*() {
    const url = `https://www.youtube.com/watch?v=${videoId}`
    const sources = yield* Sources
    const source = yield* sources.create({ origin: { _tag: "Url", url, scan: true }, rights: "unconfirmed", rightsNote: null })
    yield* sources.recordMetadata(source.id, { title: "Horse who gave up", channel: "The Dodo", url, durationS: 60 })
    const artifacts = yield* Artifacts
    const sourceOwner = { _tag: "Source", id: source.id } as const
    const video = yield* artifacts.allocate(sourceOwner, "source-video")
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x2050FF:s=128x72:r=10:d=60", "-f", "lavfi", "-i", "sine=f=330:d=60",
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", join(video.dir, "source.mp4")])
    yield* artifacts.record(video, {
      data: { path: "source.mp4", title: "Horse who gave up", channel: "The Dodo", url, duration_s: 60, width: 128, height: 72, scan: true },
      path: join(video.relDir, "source.mp4")
    })
    const tx = yield* artifacts.allocate(sourceOwner, "transcript")
    writeFileSync(join(tx.dir, "transcript.json"), JSON.stringify(transcriptOf([w("He", 40), w("runs", 40.4), w("now.", 40.8)])))
    yield* artifacts.record(tx, { data: null, path: join(tx.relDir, "transcript.json") })

    const project = yield* (yield* Projects).create({ sourceIds: [source.id as SourceId], title: "Comeback", approach: "claim-interleaved", presetId: null, musicTrackId: null })
    const owner = { _tag: "Project", id: project.id } as const
    yield* artifacts.record(yield* artifacts.allocate(owner, "script"), {
      data: { headline: null, beats: [{ _tag: "Narration", text: "This horse gave up. Not anymore." }] },
      path: null
    })
    const vo = yield* artifacts.allocate(owner, "voiceover")
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=f=220:d=2", "-ar", "48000", join(vo.dir, "vo.wav")])
    yield* artifacts.record(vo, {
      data: { voiceId: "v", model: "eleven_v4", text: "x", characters: 1, rawPace: 3, atempo: 1, pace: 3, durationS: 2 },
      path: join(vo.relDir, "vo.wav")
    })
    const voTx = yield* artifacts.allocate(owner, "voiceover-transcript")
    writeFileSync(join(voTx.dir, "transcript.json"), JSON.stringify(transcriptOf(VO)))
    yield* artifacts.record(voTx, { data: null, path: join(voTx.relDir, "transcript.json") })
    return project.id
  }))

// Runs the short to its render gate (approving the shots).
const toRenderGate = (rt: Runtime, projectId: Awaited<ReturnType<typeof scannedShort>>) =>
  rt.runPromise(Effect.gen(function*() {
    const runs = yield* RunManager
    const run = yield* runs.start({ _tag: "Project", id: projectId }, null)
    const gate = (stage: string) =>
      runs.subscribe(run.id, 0).pipe(
        Stream.filter((u: RunUpdate) => u._tag === "Event" && (u.event._tag === "RunFinished" || (u.event._tag === "RequestRaised" && u.event.request.stage === stage))),
        Stream.runHead,
        Effect.map((u): RunRequest => {
          if (u._tag === "Some" && u.value._tag === "Event" && u.value.event._tag === "RequestRaised") return u.value.event.request
          throw new Error(`the run ended before the ${stage} gate: ${JSON.stringify(u)}`)
        })
      )
    yield* runs.respond((yield* gate("shots")).id, { _tag: "Approve" })
    const request = yield* gate("render")
    yield* runs.cancel(run.id)
    return request
  }))

const renderOf = (request: RunRequest) => {
  assert.equal(request.payload?._tag, "RenderGate")
  return request.payload._tag === "RenderGate" ? request.payload.render : (undefined as never)
}

test("a found video's short renders from 1080p pieces of just the seconds it plays", { timeout: 180_000 }, async () => {
  const rt = runtime()
  const projectId = await scannedShort(rt, "jP4vNf1VvJE")
  const request = await toRenderGate(rt, projectId)
  const render = renderOf(request)
  assert.deepEqual(render.footage, [{ video: 0, title: "Horse who gave up", pieces: 3, height: 180, scanHeight: 72, clips: 3, scanClips: 0, problem: null }])
  // one request: the three shots (10–10.6, 20–20.6, 30–32+) are far enough apart for three stretches…
  const fetches = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l) as Array<string>).filter((a) => a.includes("--download-sections"))
  assert.equal(fetches.length, 1, "one yt-dlp request for the video")
  const sections = fetches[0]!.flatMap((a, i) => fetches[0]![i - 1] === "--download-sections" ? [a] : [])
  assert.equal(sections.length, 3)
  // …but the short's b-roll comes from the green pieces, not the blue scan
  const rgb = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", "0.3", "-i", render.video, "-frames:v", "1", "-vf", "crop=8:8:536:700,scale=1:1",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
  assert.ok(rgb[1]! > 60 && rgb[2]! < 90, `green footage: ${[...rgb.subarray(0, 3)]}`)
  assert.ok(existsSync(render.video))
  await rt.dispose()
})
