import { NodeServices } from "@effect/platform-node"
import { MusicBed, NarratedPlan, type RunOwner } from "@viral/contracts"
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Artifacts } from "../artifacts/artifacts.ts"
import { AssembleStage } from "../assemble/assemble-stage.ts"
import { ViralHome } from "../home/viral-home.ts"
import { MusicLibrary } from "../music-library/music-library.ts"
import { TrackAnalyser } from "../music-library/track-analyser.ts"
import { DatabaseLive } from "../persistence/database.ts"
import { Projects } from "../projects/projects.ts"
import { RunManager } from "../runs/run-manager.ts"
import { RunStore } from "../runs/run-store.ts"
import { type StageContext, StageRegistry } from "../runs/stages.ts"
import { Settings } from "../settings/settings.ts"
import { Sources } from "../sources/sources.ts"
import { MusicBedFitter } from "./music-bed-fitter.ts"
import { dropWordKey } from "./music-bed-settings.ts"
import { MusicBeds } from "./music-beds.ts"

let home: string
let song: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-music-bed-"))
  process.env.VIRAL_HOME = home
  // a song at 120 BPM (a bar is 2 s): silent until its drop at 8 s, then a loud tone, so in a fitted bed the
  // first loud sample is where the drop landed
  song = join(home, "song.wav")
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i",
    "aevalsrc='if(gte(t,8),0.8*sin(2*PI*80*t),0)|if(gte(t,8),0.8*sin(2*PI*80*t),0)':s=48000:d=20", song])
})
after(() => rmSync(home, { recursive: true, force: true }))

// The first time (seconds) the audio is loud, read back through ffmpeg.
const firstLoud = (file: string) => {
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", file, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1 << 28 })
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
  const i = samples.findIndex((x) => Math.abs(x) > 0.1)
  return { at: i / 48000, length: samples.length / 48000 }
}

const silence = (file: string, seconds: number) =>
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo:d=${seconds}`, file])

// ten voiceover words, half a second apart
const WORDS = Array.from({ length: 10 }, (_, i) => ({ w: `w${i}`, s: i * 0.5, e: i * 0.5 + 0.4 }))
const transcriptJson = (words: typeof WORDS) =>
  JSON.stringify({ source: "vo", language: "en", segments: [{ start: 0, end: words.at(-1)!.e, text: "x", words }] })

// A library whose analysis says what the test wants (no script runs).
const library = Layer.effect(MusicLibrary, MusicLibrary.make).pipe(
  Layer.provide([
    TrackAnalyser.replay(() => ({ bpm: 120, dropS: 8, loudnessLufs: -14, durationS: 20, confidence: 0.9 })),
    DatabaseLive,
    ViralHome.layer,
    NodeServices.layer,
    SecureRandom.layerWebCrypto
  ])
)

// Where the stage records go: a real run and stage run, so the artifacts point at them.
const stageContext = (owner: RunOwner) =>
  Effect.gen(function*() {
    const store = yield* RunStore
    const run = yield* store.createRun(owner, "assemble")
    const stageRun = yield* store.createStageRun(run.id, "assemble", 1, "running")
    const ctx: StageContext = {
      owner,
      runId: run.id,
      stageRunId: stageRun.id,
      attempt: 1,
      note: null,
      resumeSession: null,
      recordSession: () => Effect.void,
      progress: () => Effect.void,
      recordCost: () => Effect.void
    }
    return ctx
  })

// MusicBeds over the real RunManager, whose only stage is a do-nothing assemble
const fakeRuns = MusicBeds.layer.pipe(
  Layer.provide(RunManager.layer),
  Layer.provide(Layer.succeed(StageRegistry, StageRegistry.of({
    stagesFor: () => Effect.succeed([{ name: "assemble", artifact: "narrated-plan", gate: null, run: () => Effect.void }])
  }))),
  Layer.provide([RunStore.layer, Artifacts.layer])
)

const runtime = () =>
  ManagedRuntime.make(Layer.mergeAll(
    AssembleStage.layer,
    MusicBedFitter.layer,
    RunStore.layer,
    Sources.layer,
    Projects.layer,
    Artifacts.layer,
    Settings.layer,
    library
  ))

test("the bed loops whole groove bars so the drop lands on the word, as long as the short", async () => {
  const rt = runtime()
  const result = await rt.runPromise(Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "owned", rightsNote: null })
    const project = yield* (yield* Projects).create({ sourceId: source.id, title: "Bed", approach: "question-recap", presetId: null, musicTrackId: null })
    const track = yield* (yield* MusicLibrary).add(song, "Drop song", "owned")
    const owner = { _tag: "Project", id: project.id } as const
    // a plan whose drop (word 9, at 4.5 s) comes later than one bar of build: the groove loops first
    const dir = join(home, "fit")
    mkdirSync(dir, { recursive: true })
    silence(join(dir, "vo.wav"), 5)
    writeFileSync(join(dir, "vo.json"), transcriptJson(WORDS))
    const plan: NarratedPlan = {
      slug: "bed",
      source: join(dir, "missing-source.mp4"),
      voiceover: join(dir, "vo.wav"),
      voiceover_transcript: join(dir, "vo.json"),
      shots: [{ src: 0, word: 0 }],
      inserts: [{ start: 10, end: 11, after_word: 3 }],
      outro: [{ start: 20, end: 22 }],
      music: { file: song, drop: 8, bpm: 120, build_bars: 1, groove_bars: 1, drop_word: 9 }
    }
    const ctx = yield* stageContext(owner)
    return yield* (yield* MusicBedFitter).fit({ owner, stageRunId: ctx.stageRunId, plan, track, dropWord: 9, dropWordText: "w9" })
  }))
  // the drop word starts at 4.5 s; the insert after word 3 (1.95 s) pushes it 1 s later
  assert.equal(result.bed.dropAtS, 5.5)
  // 5 s of voiceover, the 1 s insert, the 2 s outro
  assert.equal(result.bed.durationS, 8)
  assert.ok(result.plan.music_bed !== undefined && result.plan.music_bed.drop_at === 5.5)
  const heard = firstLoud(result.plan.music_bed.file)
  assert.ok(Math.abs(heard.at - 5.5) <= 1 / 30, `the drop is heard at ${heard.at}s`)
  assert.ok(Math.abs(heard.length - 8) <= 1 / 30, `the bed is ${heard.length}s long`)

  // groove loops (entered part-way), the one bar of build, then the drop: back to back, in playing order
  const kinds = result.bed.segments.map((s) => s.kind)
  assert.deepEqual([...new Set(kinds)], ["groove", "build", "drop"])
  result.bed.segments.forEach((s, i) => {
    const next = result.bed.segments[i + 1]
    if (next !== undefined) assert.ok(Math.abs(s.at + (s.to - s.from) - next.at) < 0.001, `segment ${i} runs into the next`)
  })
  assert.deepEqual(result.bed.segments.find((s) => s.kind === "build"), { kind: "build", from: 6, to: 8, at: 3.5 })
  assert.equal(result.bed.segments.at(-1)?.at, 5.5)
  await rt.dispose()
})

test("assemble fits the short's own bed, points the plan at it, and honours a drop word you picked", async () => {
  const rt = runtime()
  const { first, second, owner } = await rt.runPromise(Effect.gen(function*() {
    const artifacts = yield* Artifacts
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/y" }, rights: "owned", rightsNote: null })
    const sourceOwner = { _tag: "Source", id: source.id } as const
    const library = yield* MusicLibrary
    const track = yield* library.setBeat((yield* library.add(song, "Drop song", "owned")).id, 120, 8)
    const projects = yield* Projects
    const project = yield* projects.create({ sourceId: source.id, title: "Bed", approach: "question-recap", presetId: null, musicTrackId: null })
    yield* projects.setMusic(project.id, track.id)
    const owner = { _tag: "Project", id: project.id } as const

    // what assemble reads: the source's video and transcript, the script, the shots and the voiceover
    for (const kind of ["source-video", "transcript"] as const) {
      const slot = yield* artifacts.allocate(sourceOwner, kind)
      writeFileSync(join(slot.dir, "file"), "x")
      yield* artifacts.record(slot, { data: null, path: join(slot.relDir, "file") })
    }
    yield* artifacts.record(yield* artifacts.allocate(owner, "script"), {
      data: { headline: null, beats: [{ _tag: "Narration", text: "w0 w1 w2 w3 w4" }, { _tag: "Narration", text: "w5 w6 w7 w8 w9" }] },
      path: null
    })
    yield* artifacts.record(yield* artifacts.allocate(owner, "shot-plan"), {
      data: {
        shots: [{ word: 0, src: 30, note: "n", wordText: "w0", frame: null }],
        markers: [],
        highlights: [],
        inserts: [],
        outro: [{ start: 50, end: 52, quote: "So nasty.", frame: null }],
        storyboard: null
      },
      path: null
    })
    const vo = yield* artifacts.allocate(owner, "voiceover")
    silence(join(vo.dir, "vo.wav"), 5)
    yield* artifacts.record(vo, { data: null, path: join(vo.relDir, "vo.wav") })
    const tx = yield* artifacts.allocate(owner, "voiceover-transcript")
    writeFileSync(join(tx.dir, "transcript.json"), transcriptJson(WORDS))
    yield* artifacts.record(tx, { data: null, path: join(tx.relDir, "transcript.json") })

    const assemble = (yield* AssembleStage).narrated
    const latest = Effect.gen(function*() {
      const plan = yield* Schema.decodeUnknownEffect(NarratedPlan)(Option.getOrThrow(yield* artifacts.latest(owner, "narrated-plan")).data)
      const bed = yield* Schema.decodeUnknownEffect(MusicBed)(Option.getOrThrow(yield* artifacts.latest(owner, "music-bed")).data)
      return { plan, bed }
    })
    // by default the drop lands on the first word of the last narrated line (word 5, at 2.5 s)
    yield* assemble.run(yield* stageContext(owner))
    const first = yield* latest
    // you pick word 7 for this short
    yield* (yield* Settings).set(dropWordKey(project.id), 7)
    yield* assemble.run(yield* stageContext(owner))
    return { first, second: yield* latest, owner }
  }))

  assert.equal(first.bed.dropWord, 5)
  assert.equal(first.bed.dropWordText, "w5")
  assert.equal(first.bed.dropAtS, 2.5)
  assert.equal(first.bed.trackTitle, "Drop song")
  assert.equal(first.bed.durationS, 7)
  assert.ok(first.plan.music_bed !== undefined, "the plan points at the fitted bed")
  assert.ok(Math.abs(firstLoud(first.plan.music_bed.file).at - 2.5) <= 1 / 30)
  assert.equal(second.bed.dropWord, 7)
  assert.equal(second.bed.dropAtS, 3.5)
  assert.ok(second.plan.music_bed !== undefined && second.plan.music_bed.file !== first.plan.music_bed.file, "a new version")

  // the workspace reads the latest bed and serves its wav from the short's folder
  const shown = await rt.runPromise(Effect.gen(function*() { return yield* (yield* MusicBeds).get(owner.id) }).pipe(Effect.provide(fakeRuns)))
  assert.equal(shown?.bed.dropWord, 7)
  assert.ok(shown?.media.startsWith(`projects/`) && shown.media.endsWith("bed.wav"), shown?.media)
  await rt.dispose()
})

test("RefitMusic sets the song and the drop word, then re-runs the short from assemble; null takes them away", async () => {
  const rt = runtime()
  const { started, withMusic, word, without, wordAfter } = await rt.runPromise(Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/z" }, rights: "owned", rightsNote: null })
    const projects = yield* Projects
    const project = yield* projects.create({ sourceId: source.id, title: "Refit", approach: "question-recap", presetId: null, musicTrackId: null })
    const track = yield* (yield* MusicLibrary).add(song, "Drop song", "owned")
    const beds = yield* MusicBeds
    const settings = yield* Settings
    const started = yield* beds.refit(project.id, track.id, 3)
    const withMusic = (yield* projects.get(project.id)).musicTrackId
    const word = yield* settings.get(dropWordKey(project.id), Schema.Int)
    yield* beds.refit(project.id, null, null)
    return {
      started,
      withMusic: withMusic === track.id,
      word,
      without: (yield* projects.get(project.id)).musicTrackId,
      wordAfter: yield* settings.get(dropWordKey(project.id), Schema.Int)
    }
  }).pipe(Effect.provide(fakeRuns)))
  assert.equal(started.fromStage, "assemble")
  assert.ok(withMusic)
  assert.deepEqual(word, Option.some(3))
  assert.equal(without, null)
  assert.ok(Option.isNone(wordAfter))
  await rt.dispose()
})
