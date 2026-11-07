import { NodeServices } from "@effect/platform-node"
import { type MusicArrangement, MusicArrangementInvalid, MusicBed, NarratedPlan, type ProjectId, type RunOwner } from "@viral/contracts"
import { Effect, Exit, Layer, ManagedRuntime, Option, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
import { arrangementKey, dropWordKey } from "./music-bed-settings.ts"
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
    return yield* (yield* MusicBedFitter).fit({ owner, stageRunId: ctx.stageRunId, plan, track, dropWord: 9, dropWordText: "w9", arrangement: null })
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

  // the same recipe, described as blocks of whole bars (bar 0 starts the song; the drop is bar 4)
  const arrangement = result.bed.arrangement
  assert.equal(arrangement?.automatic, true)
  assert.equal(arrangement?.dropBar, 4)
  assert.equal(arrangement?.songBars, 10)
  assert.deepEqual(arrangement?.blocks.map((b) => [b.fromBar, b.toBar, b.start, b.atS, b.endS]), [
    [3, 4, "after", 0, 3.5],
    [3, 4, "after", 3.5, 5.5],
    [4, 10, "drop", 5.5, 8]
  ])
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

// The audio as mono samples at 48 kHz.
const samplesOf = (file: string) => {
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-i", file, "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1 << 28 })
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
}
const loudFrom = (samples: Float32Array, from: number) => {
  const i = samples.findIndex((x, n) => n >= from && Math.abs(x) > 0.1)
  return i
}
const loudBetween = (samples: Float32Array, from: number, to: number) =>
  samples.subarray(Math.round(from * 48000), Math.round(to * 48000)).some((x) => Math.abs(x) > 0.1)

test("an arrangement loops a block, joins another part of the song and lands a pinned second hit on its word", async () => {
  // a song at 120 BPM: loud only in bar 4 (8-10 s, the drop) and bar 7 (14-16 s), silent elsewhere
  const hits = join(home, "hits.wav")
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i",
    "aevalsrc='if(between(t,8,10)+between(t,14,16),0.8*sin(2*PI*80*t),0)|if(between(t,8,10)+between(t,14,16),0.8*sin(2*PI*80*t),0)':s=48000:d=20", hits])
  // 20 voiceover words a second apart; no inserts or outro, so the short is the 20 s of voiceover
  const words = Array.from({ length: 20 }, (_, i) => ({ w: `w${i}`, s: i, e: i + 0.6 }))
  const dir = join(home, "arranged")
  mkdirSync(dir, { recursive: true })
  silence(join(dir, "vo.wav"), 20)
  writeFileSync(join(dir, "vo.json"), transcriptJson(words))
  const arrangement: MusicArrangement = {
    blocks: [
      { fromBar: 0, toBar: 2, loops: 1, start: "after" }, // silent lead-in, looped to fill the start
      { fromBar: 4, toBar: 5, loops: 1, start: "drop" }, // the drop on the drop word (word 5, 5 s)
      { fromBar: 5, toBar: 6, loops: 1, start: "after" }, // silent, looped until the next pin
      { fromBar: 7, toBar: 8, loops: 1, start: { word: 12 } }, // a second hit on word 12 (12 s), from later in the song
      { fromBar: 2, toBar: 4, loops: 1, start: "after" } // silent to the end
    ]
  }
  const plan: NarratedPlan = {
    slug: "arranged",
    source: join(dir, "missing-source.mp4"),
    voiceover: join(dir, "vo.wav"),
    voiceover_transcript: join(dir, "vo.json"),
    shots: [{ src: 0, word: 0 }],
    music: {
      file: hits,
      drop: 8,
      bpm: 120,
      drop_word: 5,
      arrangement: [
        { from_bar: 0, to_bar: 2, loops: 1 },
        { from_bar: 4, to_bar: 5, loops: 1, word: 5 },
        { from_bar: 5, to_bar: 6, loops: 1 },
        { from_bar: 7, to_bar: 8, loops: 1, word: 12 },
        { from_bar: 2, to_bar: 4, loops: 1 }
      ]
    }
  }
  const rt = runtime()
  const result = await rt.runPromise(Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/arr" }, rights: "owned", rightsNote: null })
    const project = yield* (yield* Projects).create({ sourceId: source.id, title: "Arranged", approach: "question-recap", presetId: null, musicTrackId: null })
    const track = yield* (yield* MusicLibrary).add(hits, "Hits", "owned")
    const owner = { _tag: "Project", id: project.id } as const
    const ctx = yield* stageContext(owner)
    return yield* (yield* MusicBedFitter).fit({ owner, stageRunId: ctx.stageRunId, plan, track, dropWord: 5, dropWordText: "w5", arrangement })
  }))
  await rt.dispose()

  const bed = samplesOf(result.plan.music_bed!.file)
  assert.equal(bed.length, 20 * 48000, "the bed is as long as the short")
  // where the tone first passes the threshold after its bar line, in the song itself
  const song = samplesOf(hits)
  const lag = loudFrom(song, 8 * 48000) - 8 * 48000
  assert.equal(loudFrom(song, 14 * 48000 - 100) - 14 * 48000, lag, "both hits rise the same way")
  // the drop on its word, the second hit on word 12: each within a sample of the word
  assert.ok(Math.abs(loudFrom(bed, 0) - (5 * 48000 + lag)) <= 1, `the drop starts at sample ${loudFrom(bed, 0)}`)
  assert.ok(Math.abs(loudFrom(bed, 8 * 48000) - (12 * 48000 + lag)) <= 1, `the second hit starts at sample ${loudFrom(bed, 8 * 48000)}`)
  // silent where the silent blocks loop, and after the second hit's bar
  assert.ok(!loudBetween(bed, 0, 4.99), "the lead-in is silent")
  assert.ok(!loudBetween(bed, 7.01, 11.99), "the block after the drop loops silently until the second hit")
  assert.ok(!loudBetween(bed, 14.01, 20), "the last block plays to the end")

  const played = result.bed.arrangement!
  assert.equal(played.automatic, false)
  assert.deepEqual(played.blocks.map((b) => [b.start, b.atS, b.endS]), [
    ["after", 0, 5],
    ["drop", 5, 7],
    ["after", 7, 12],
    [{ word: 12 }, 12, 14],
    ["after", 14, 20]
  ])
  assert.deepEqual(played.blocks.map((b) => [b.fromS, b.toS]), [[0, 4], [8, 10], [10, 12], [14, 16], [4, 8]])
})

const showOwner = (id: ProjectId) => ({ _tag: "Project", id }) as const

test("arrangements are checked in plain words, stored per short, previewed without a run, and follow the song and drop word", async () => {
  const rt = runtime()
  const out = await rt.runPromise(Effect.gen(function*() {
    const artifacts = yield* Artifacts
    const settings = yield* Settings
    const projects = yield* Projects
    const library = yield* MusicLibrary
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/arrange" }, rights: "owned", rightsNote: null })
    const track = yield* library.setBeat((yield* library.add(song, "Drop song", "owned")).id, 120, 8)
    const other = yield* library.setBeat((yield* library.add(song, "Other song", "owned")).id, 120, 8)
    const project = yield* projects.create({ sourceId: source.id, title: "Arrange", approach: "question-recap", presetId: null, musicTrackId: null })
    yield* projects.setMusic(project.id, track.id)
    const owner = showOwner(project.id)

    // the short so far: a voiceover of ten words over 5 s, and its assembled plan with the fitted bed (7 s)
    const tx = yield* artifacts.allocate(owner, "voiceover-transcript")
    writeFileSync(join(tx.dir, "transcript.json"), transcriptJson(WORDS))
    yield* artifacts.record(tx, { data: null, path: join(tx.relDir, "transcript.json") })
    const dir = join(home, "arrange")
    mkdirSync(dir, { recursive: true })
    silence(join(dir, "vo.wav"), 5)
    const plan: NarratedPlan = {
      slug: "arrange",
      source: join(dir, "missing-source.mp4"),
      voiceover: join(dir, "vo.wav"),
      voiceover_transcript: join(tx.dir, "transcript.json"),
      shots: [{ src: 0, word: 0 }],
      outro: [{ start: 20, end: 22 }],
      music: { file: song, drop: 8, bpm: 120, build_bars: 8, groove_bars: 4, drop_word: 5 }
    }
    const fitted = yield* (yield* MusicBedFitter).fit({
      owner,
      stageRunId: (yield* stageContext(owner)).stageRunId,
      plan,
      track,
      dropWord: 5,
      dropWordText: "w5",
      arrangement: null
    })
    yield* artifacts.record(yield* artifacts.allocate(owner, "narrated-plan"), { data: fitted.plan, path: null })

    const beds = yield* MusicBeds
    const bad: MusicArrangement = {
      blocks: [
        { fromBar: 0, toBar: 12, loops: 1, start: "after" },
        { fromBar: 3, toBar: 3, loops: 0, start: "drop" },
        { fromBar: 4, toBar: 5, loops: 1, start: { word: 2 } },
        { fromBar: 4, toBar: 5, loops: 1, start: { word: 40 } }
      ]
    }
    const rejected = yield* Effect.exit(beds.arrange(project.id, bad))
    const tooMany = yield* Effect.exit(beds.preview(project.id, {
      blocks: Array.from({ length: 13 }, () => ({ fromBar: 0, toBar: 1, loops: 1, start: "after" as const }))
    }))
    const late = yield* Effect.exit(beds.arrange(project.id, {
      blocks: [{ fromBar: 4, toBar: 5, loops: 1, start: "drop" }, { fromBar: 0, toBar: 4, loops: 1, start: "after" }, { fromBar: 0, toBar: 1, loops: 1, start: "after" }]
    }))

    const good: MusicArrangement = {
      blocks: [{ fromBar: 0, toBar: 2, loops: 1, start: "after" }, { fromBar: 4, toBar: 6, loops: 1, start: "drop" }]
    }
    const preview = yield* beds.preview(project.id, good)
    const preview2 = yield* beds.preview(project.id, null)
    const run = yield* beds.arrange(project.id, good)
    const stored = yield* settings.get(arrangementKey(project.id), Schema.Unknown)
    // a new drop word keeps the arrangement; a different song drops it
    yield* beds.refit(project.id, track.id, 7)
    const keptOnDropWord = yield* settings.get(arrangementKey(project.id), Schema.Unknown)
    yield* beds.refit(project.id, other.id, undefined)
    const afterNewSong = yield* settings.get(arrangementKey(project.id), Schema.Unknown)
    yield* beds.refit(project.id, track.id, undefined)
    yield* beds.arrange(project.id, good)
    yield* beds.arrange(project.id, null)
    const afterReset = yield* settings.get(arrangementKey(project.id), Schema.Unknown)
    return { rejected, tooMany, late, preview, preview2, run, stored, keptOnDropWord, afterNewSong, afterReset }
  }).pipe(Effect.provide(fakeRuns)))
  await rt.dispose()

  const isInvalid = Schema.is(MusicArrangementInvalid)
  const problems = (exit: Exit.Exit<unknown, unknown>) => {
    const reason = Exit.isFailure(exit) ? exit.cause.reasons[0] : undefined
    return reason?._tag === "Fail" && isInvalid(reason.error) ? reason.error.problems : []
  }
  assert.deepEqual(problems(out.rejected), [
    "block 1 runs to bar 12, but the song has 10 whole bars",
    "block 2 has to end after it starts (bars 3 to 3)",
    "block 2 has to play at least once",
    "block 3 is pinned to \"w2\" at 1.00s, not after block 2's word at 2.50s; pinned blocks follow the voiceover in order",
    "block 4 is pinned to word 40, but the voiceover has 10 words"
  ])
  assert.deepEqual(problems(out.tooMany), ["an arrangement has at most 12 blocks; this one has 13"])
  assert.deepEqual(problems(out.late), ["block 3 would start at 12.50s, after the short ends at 7.00s; remove it or pin it earlier"])

  // a preview is a wav in the short's music-preview folder, replaced by the next one; the short is unchanged
  assert.ok(out.preview.media.startsWith("projects/") && out.preview.media.includes("music-preview/"), out.preview.media)
  assert.equal(out.preview.bed.arrangement?.automatic, false)
  assert.ok(Math.abs(firstLoud(join(home, out.preview2.media)).at - 2.5) <= 1 / 30, "the drop lands on its word")
  assert.ok(!existsSync(join(home, out.preview.media)), "the last preview is gone")
  assert.ok(existsSync(join(home, out.preview2.media)))
  assert.equal(out.preview2.bed.arrangement?.automatic, true)

  assert.equal(out.run.fromStage, "assemble")
  assert.ok(Option.isSome(out.stored))
  assert.ok(Option.isSome(out.keptOnDropWord))
  assert.ok(Option.isNone(out.afterNewSong))
  assert.ok(Option.isNone(out.afterReset))
})

test("assemble fits your arrangement, and falls back to the automatic one when it no longer fits", async () => {
  const rt = runtime()
  const { arranged, fallback } = await rt.runPromise(Effect.gen(function*() {
    const artifacts = yield* Artifacts
    const settings = yield* Settings
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/asm" }, rights: "owned", rightsNote: null })
    const sourceOwner = { _tag: "Source", id: source.id } as const
    const library = yield* MusicLibrary
    const track = yield* library.setBeat((yield* library.add(song, "Drop song", "owned")).id, 120, 8)
    const projects = yield* Projects
    const project = yield* projects.create({ sourceId: source.id, title: "Asm", approach: "question-recap", presetId: null, musicTrackId: null })
    yield* projects.setMusic(project.id, track.id)
    const owner = showOwner(project.id)
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
      data: { shots: [{ word: 0, src: 30, note: "n", wordText: "w0", frame: null }], markers: [], highlights: [], inserts: [], outro: [], storyboard: null },
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
    const arrangement: MusicArrangement = {
      blocks: [{ fromBar: 1, toBar: 2, loops: 2, start: "after" }, { fromBar: 4, toBar: 6, loops: 1, start: "drop" }, { fromBar: 4, toBar: 5, loops: 1, start: { word: 8 } }]
    }
    yield* settings.set(arrangementKey(project.id), arrangement)
    yield* assemble.run(yield* stageContext(owner))
    const arranged = yield* latest
    // pinned to a word the voiceover doesn't have: the automatic bed, with a note
    yield* settings.set(arrangementKey(project.id), { blocks: [{ fromBar: 4, toBar: 5, loops: 1, start: { word: 99 } }] })
    yield* assemble.run(yield* stageContext(owner))
    return { arranged, fallback: yield* latest }
  }))
  await rt.dispose()

  const music = arranged.plan.music
  assert.ok(typeof music === "object")
  assert.deepEqual(music.arrangement, [
    { from_bar: 1, to_bar: 2, loops: 2 },
    { from_bar: 4, to_bar: 6, loops: 1, word: 5 },
    { from_bar: 4, to_bar: 5, loops: 1, word: 8 }
  ])
  assert.equal(arranged.bed.arrangement?.automatic, false)
  assert.deepEqual(arranged.bed.arrangement?.blocks.map((b) => b.start), ["after", "drop", { word: 8 }])
  assert.deepEqual(arranged.bed.arrangement?.blocks.map((b) => b.atS), [0, 2.5, 4])
  assert.ok(Math.abs(firstLoud(arranged.plan.music_bed!.file).at - 2.5) <= 1 / 30)
  assert.equal(fallback.bed.arrangement?.automatic, true)
  const fallbackMusic = fallback.plan.music
  assert.ok(typeof fallbackMusic === "object" && fallbackMusic.arrangement === undefined)
})
