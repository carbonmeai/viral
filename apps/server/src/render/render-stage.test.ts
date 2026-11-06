import { PublishedShort, type RunUpdate } from "@viral/contracts"
import { Effect, Layer, ManagedRuntime, Option, Schema, Stream } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
import { Transcriber } from "../transcribe/transcriber.ts"
import { ElevenLabs } from "../voice/eleven-labs.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-render-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

const w = (word: string, s: number, e = s + 0.4) => ({ w: word, s, e })
const transcriptOf = (words: ReadonlyArray<{ w: string; s: number; e: number }>) => ({
  source: "x",
  language: "en",
  segments: [{ start: words[0]!.s, end: words.at(-1)!.e, text: words.map((x) => x.w).join(" "), words }]
})
// a 2s voiceover: "This guy tasted it. It hurt."
const VO = ["This", "guy", "tasted", "it.", "It", "hurt."].map((word, i) => w(word, i * 0.3, i * 0.3 + 0.25))

// The replayed agents: the shots agent plans twice (the render is rejected back to it once); metadata titles it.
const asked: Array<AgentTask<Schema.Top>> = []
const replay = AgentSession.replay((task) => {
  asked.push(task)
  if (task.stage === "thumbnail") {
    return {
      background: { src: 10 },
      hero: { src: 12, crop: [0.1, 0.1, 0.9, 0.9], circle: { x: 0.5, y: 0.5, r: 0.3 } },
      face: { src: 20, crop: [0.3, 0, 0.8, 1] },
      lines: [{ text: "it", color: "yellow" }, { text: "hurt", color: "white" }]
    }
  }
  if (task.stage === "metadata") {
    return {
      title: "He Tasted It",
      alternates: ["It Hurt", "The Taste Test"],
      description: "This guy tasted it. How did it go?",
      hashtags: ["#shorts", "#science", "#test"]
    }
  }
  const second = asked.filter((t) => t.stage === "shots").length > 1
  return {
    shots: [{ word: 0, src: second ? 12 : 10, note: "him" }, { word: 2, src: 20, note: "tasting" }, { word: 4, src: 30, note: "pain" }],
    markers: [],
    highlights: ["hurt"]
  }
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
        replay,
        ElevenLabs.replay(() => new Uint8Array()),
        Transcriber.layer
      ))
    )
  )

test("a short renders, a rejected render goes back to the shots, and the approved one is published", async () => {
  const rt = runtime()
  const projectId = await rt.runPromise(Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "owned", rightsNote: null })
    const artifacts = yield* Artifacts
    const sourceOwner = { _tag: "Source", id: source.id } as const
    const video = yield* artifacts.allocate(sourceOwner, "source-video")
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=d=60:s=320x180:r=25", "-f", "lavfi", "-i", "sine=f=330:d=60",
      "-shortest", "-c:v", "libx264", "-c:a", "aac", join(video.dir, "source.mp4")])
    yield* artifacts.record(video, { data: null, path: join(video.relDir, "source.mp4") })
    const tx = yield* artifacts.allocate(sourceOwner, "transcript")
    writeFileSync(join(tx.dir, "transcript.json"), JSON.stringify(transcriptOf([w("Ow,", 40), w("that", 40.4), w("hurts.", 40.8), w("Nasty.", 50), w("Bye.", 55)])))
    yield* artifacts.record(tx, { data: null, path: join(tx.relDir, "transcript.json") })

    const project = yield* (yield* Projects).create({ sourceId: source.id, title: "Pain", approach: "claim-interleaved", presetId: null, musicTrackId: null })
    const owner = { _tag: "Project", id: project.id } as const
    yield* artifacts.record(yield* artifacts.allocate(owner, "script"), {
      data: {
        headline: null,
        beats: [
          { _tag: "Narration", text: "This guy tasted it." },
          // two real lines in a row in the middle: back-to-back inserts after the same word
          { _tag: "Real", quote: "Ow, that hurts.", start: 40, end: 41.2 },
          { _tag: "Real", quote: "Nasty.", start: 50, end: 50.4 },
          { _tag: "Narration", text: "It hurt." },
          { _tag: "Real", quote: "Bye.", start: 55, end: 55.4 }
        ]
      },
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

  await rt.runPromise(Effect.gen(function*() {
    const runs = yield* RunManager
    const run = yield* runs.start({ _tag: "Project", id: projectId }, null)
    const answered = new Set<string>()
    const nextGate = (stage: string) =>
      runs.subscribe(run.id, 0).pipe(
        Stream.filter((u: RunUpdate) =>
          (u._tag === "Event" && u.event._tag === "RunFinished") ||
          (u._tag === "Event" && u.event._tag === "RequestRaised" && u.event.request.stage === stage && !answered.has(u.event.request.id))
        ),
        Stream.runHead,
        Effect.map((u) => {
          const update = Option.getOrThrow(u)
          assert.ok(update._tag === "Event" && update.event._tag === "RequestRaised", `the run ended before the ${stage} gate`)
          answered.add(update.event.request.id)
          return update.event.request
        })
      )
    yield* runs.respond((yield* nextGate("shots")).id, { _tag: "Approve" })
    const firstRender = yield* nextGate("render")
    assert.equal(firstRender.payload?._tag, "RenderGate")
    yield* runs.respond(firstRender.id, { _tag: "Reject", note: "open on the other shot" })
    // back at the shots, with the note
    yield* runs.respond((yield* nextGate("shots")).id, { _tag: "Approve" })
    yield* runs.respond((yield* nextGate("render")).id, { _tag: "Approve" })
    const thumbnail = yield* nextGate("thumbnail")
    assert.equal(thumbnail.payload?._tag, "ThumbnailGate")
    yield* runs.respond(thumbnail.id, { _tag: "Approve" })
    const finished = yield* runs.subscribe(run.id, 0).pipe(
      Stream.filter((u: RunUpdate) => u._tag === "Event" && u.event._tag === "RunFinished"),
      Stream.runHead
    )
    const event = Option.getOrThrow(finished)
    assert.ok(event._tag === "Event" && event.event._tag === "RunFinished")
    assert.equal(event.event.run.status, "completed", event.event.run.error ?? "")
  }))

  const shotsAsks = asked.filter((t) => t.stage === "shots")
  assert.equal(shotsAsks.length, 2)
  assert.match(shotsAsks[1]!.message, /open on the other shot/, "the render's note reached the shots agent")

  const published = await rt.runPromise(Effect.gen(function*() {
    const artifact = Option.getOrThrow(yield* (yield* Artifacts).latest({ _tag: "Project", id: projectId }, "metadata"))
    return yield* Schema.decodeUnknownEffect(PublishedShort)(artifact.data)
  }))
  assert.equal(published.title, "He Tasted It")
  assert.equal(published.credit, null, "your own footage needs no credit")
  for (const file of [published.video, published.captions, published.notes]) assert.ok(existsSync(file), `${file} was published`)
  // the approved thumbnail went next to the mp4
  const jpg = published.video.replace(/\.mp4$/, ".jpg")
  assert.ok(existsSync(jpg), "the thumbnail was published")
  assert.equal(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", jpg]).toString().trim(), "1080,1920")
  assert.match(readFileSync(published.notes, "utf8"), /^# He Tasted It/)
  // 2s of narration + 1.2s and 0.4s inserts + a 0.4s outro
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", published.video]))
  assert.ok(Math.abs(seconds - 4) < 0.3, `the short is ${seconds}s`)
  const plan = await rt.runPromise(Effect.gen(function*() {
    return Option.getOrThrow(yield* (yield* Artifacts).latest({ _tag: "Project", id: projectId }, "narrated-plan")).data
  }))
  assert.ok(typeof plan === "object" && plan !== null && "shots" in plan)
  await rt.dispose()
})
