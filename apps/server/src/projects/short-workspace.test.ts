import type { Script } from "@viral/contracts"
import { Effect, Layer, ManagedRuntime } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
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
    const project = yield* (yield* Projects).create({ sourceIds: [source.id], title: "Every taste", approach: "claim-interleaved", presetId: null, musicTrackId: null })
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

test("a short from two videos lists both, V1 first, with their files and lengths", async () => {
  const rt = ManagedRuntime.make(Layer.mergeAll(ShortWorkspaces.layer, Sources.layer, Projects.layer, Artifacts.layer, RunStore.layer))
  const { workspace, ids } = await rt.runPromise(Effect.gen(function*() {
    const sources = yield* Sources
    const artifacts = yield* Artifacts
    const v1 = yield* sources.create({ origin: { _tag: "Url", url: "https://youtu.be/one" }, rights: "owned", rightsNote: null })
    const v2 = yield* sources.create({ origin: { _tag: "Url", url: "https://youtu.be/two" }, rights: "licensed", rightsNote: null })
    // only V2 has been fetched
    const video = yield* artifacts.allocate({ _tag: "Source", id: v2.id }, "source-video")
    yield* artifacts.record(video, { data: null, path: join(video.relDir, "source.mp4") })
    const project = yield* (yield* Projects).create({
      sourceIds: [v1.id, v2.id],
      title: "Two",
      approach: "claim-interleaved",
      presetId: null,
      musicTrackId: null,
      brief: "Both videos."
    })
    return { workspace: yield* (yield* ShortWorkspaces).get(project.id), ids: [v1.id, v2.id] }
  }))
  assert.deepEqual(workspace.videos.map((v) => [v.position, v.source.id]), [[0, ids[0]], [1, ids[1]]])
  assert.equal(workspace.videos[0]!.video, null, "V1 isn't fetched yet")
  assert.match(workspace.videos[1]!.video ?? "", /source-video\/v1\/source\.mp4$/)
  assert.equal(workspace.source.id, ids[0], "`source` stays V1")
  assert.equal(workspace.sourceVideo, null, "`sourceVideo` stays V1's")
  await rt.dispose()
})

test("an edited script is checked against the approach and the transcript before it's sent", async () => {
  const rt = ManagedRuntime.make(Layer.mergeAll(ShortWorkspaces.layer, Sources.layer, Projects.layer, Artifacts.layer))
  const problems = await rt.runPromise(Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/y" }, rights: "owned", rightsNote: null })
    const artifacts = yield* Artifacts
    const tx = yield* artifacts.allocate({ _tag: "Source", id: source.id }, "transcript")
    writeFileSync(join(tx.dir, "transcript.json"), JSON.stringify({
      source: "x",
      language: "en",
      segments: [{ start: 200, end: 201, text: "It worked.", words: [{ w: "It", s: 200, e: 200.3 }, { w: "worked.", s: 200.3, e: 200.9 }] }]
    }))
    yield* artifacts.record(tx, { data: null, path: join(tx.relDir, "transcript.json") })
    const project = yield* (yield* Projects).create({ sourceIds: [source.id], title: "Edit", approach: "claim-interleaved", presetId: null, musicTrackId: null })
    return yield* (yield* ShortWorkspaces).checkScript(project.id, script)
  }))
  assert.ok(problems.some((p) => /narration is 5 words/.test(p)), problems.join("; "))
  assert.ok(problems.some((p) => /there are 1 real lines/.test(p)))
  assert.equal(problems.some((p) => /isn't in the transcript/.test(p)), false, "the real line was found")
  await rt.dispose()
})

test("an edited shot list is checked against the voiceover, the video and its ads before it's sent", async () => {
  const rt = ManagedRuntime.make(Layer.mergeAll(ShortWorkspaces.layer, Sources.layer, Projects.layer, Artifacts.layer))
  const [before, problems, good] = await rt.runPromise(Effect.gen(function*() {
    const sources = yield* Sources
    const source = yield* sources.create({ origin: { _tag: "Url", url: "https://youtu.be/z" }, rights: "owned", rightsNote: null })
    yield* sources.recordMetadata(source.id, { title: "z", channel: null, url: null, durationS: 300 })
    const artifacts = yield* Artifacts
    yield* artifacts.record(yield* artifacts.allocate({ _tag: "Source", id: source.id }, "ad-ranges"), {
      data: { ranges: [{ start: 0, end: 3, kind: "sponsor", evidence: "x" }] },
      path: null
    })
    const project = yield* (yield* Projects).create({ sourceIds: [source.id], title: "Shots", approach: "claim-interleaved", presetId: null, musicTrackId: null })
    const workspaces = yield* ShortWorkspaces
    const owner = { _tag: "Project", id: project.id } as const
    const before = yield* workspaces.checkShots(project.id, { shots: [{ word: 0, src: 10, note: "n" }], markers: [] })

    yield* artifacts.record(yield* artifacts.allocate(owner, "script"), { data: script, path: null })
    const vo = yield* artifacts.allocate(owner, "voiceover")
    yield* artifacts.record(vo, {
      data: { voiceId: "v", model: "eleven_v4", text: "x", characters: 20, rawPace: 2.7, atempo: 1.16, pace: 3.2, durationS: 2 },
      path: join(vo.relDir, "vo.wav")
    })
    const tx = yield* artifacts.allocate(owner, "voiceover-transcript")
    const words = ["This", "guy", "made", "a", "candy."].map((w, i) => ({ w, s: i * 0.4, e: i * 0.4 + 0.3 }))
    writeFileSync(join(tx.dir, "transcript.json"), JSON.stringify({ source: "vo.wav", language: "en", segments: [{ start: 0, end: 2, text: "x", words }] }))
    yield* artifacts.record(tx, { data: null, path: join(tx.relDir, "transcript.json") })

    const problems = yield* workspaces.checkShots(project.id, {
      shots: [{ word: 0, src: 1, note: "in the ad" }, { word: 9, src: 400, note: "past the end" }],
      markers: []
    })
    const good = yield* workspaces.checkShots(project.id, { shots: [{ word: 0, src: 100, note: "fine" }], markers: [] })
    return [before, problems, good] as const
  }))
  assert.match(before.join("; "), /needs its script and voiceover/)
  const text = problems.join("\n")
  assert.match(text, /inside an excluded range/)
  assert.match(text, /word 9 isn't in the voiceover/)
  assert.deepEqual(good, [])
  await rt.dispose()
})

test("a published short shows its render, files and thumbnail as media paths, and a thumbnail edit is checked first", async () => {
  const rt = ManagedRuntime.make(Layer.mergeAll(ShortWorkspaces.layer, Sources.layer, Projects.layer, Artifacts.layer, RunStore.layer))
  const { ws, bold, tooMany, inAd } = await rt.runPromise(Effect.gen(function*() {
    const sources = yield* Sources
    const source = yield* sources.create({ origin: { _tag: "Url", url: "https://youtu.be/y" }, rights: "unconfirmed", rightsNote: null })
    const artifacts = yield* Artifacts
    const sourceOwner = { _tag: "Source", id: source.id } as const
    // a real (tiny) video, so the thumbnail check can read its frame size
    const video = yield* artifacts.allocate(sourceOwner, "source-video")
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=d=60:s=320x180:r=5", join(video.dir, "source.mp4")])
    yield* artifacts.record(video, { data: null, path: join(video.relDir, "source.mp4") })
    yield* artifacts.record(yield* artifacts.allocate(sourceOwner, "ad-ranges"), { data: { ranges: [{ start: 50, end: 60, kind: "sponsor", evidence: "x" }] }, path: null })
    const project = yield* (yield* Projects).create({ sourceIds: [source.id], title: "Pain", approach: "claim-interleaved", presetId: null, musicTrackId: null })
    const owner = { _tag: "Project", id: project.id } as const

    // the render and the published files, as the render and metadata stages record them (absolute paths)
    const render = yield* artifacts.allocate(owner, "render")
    const mp4 = join(render.dir, `${project.slug}.mp4`)
    for (const file of [mp4, join(render.dir, `${project.slug}.srt`), join(render.dir, "check.png")]) writeFileSync(file, "x")
    yield* artifacts.record(render, {
      data: { video: mp4, captions: join(render.dir, `${project.slug}.srt`), durationS: 12.5, shots: 6, checkSheet: join(render.dir, "check.png") },
      path: join(render.relDir, `${project.slug}.mp4`)
    })
    const renders = join(home, "renders")
    for (const ext of ["mp4", "srt", "md"]) writeFileSync(join(renders, `${project.slug}.${ext}`), "x")
    // recorded when the library lived somewhere else: the files are still found in the renders folder by name
    const moved = "/Users/someone/old-viral/renders"
    yield* artifacts.record(yield* artifacts.allocate(owner, "metadata"), {
      data: {
        title: "It Broke Him",
        alternates: ["One Bite Too Far", "The Pain Candy"],
        description: "This guy made a candy.",
        hashtags: ["#shorts"],
        credit: "NileBlue",
        video: join(moved, `${project.slug}.mp4`),
        captions: join(moved, `${project.slug}.srt`),
        notes: join(moved, `${project.slug}.md`)
      },
      path: null
    })
    writeFileSync(join(renders, `${project.slug}.jpg`), "jpg")
    const config = {
      layout: "bold" as const,
      source: "x",
      background: { src: 5 },
      hero: { src: 10, box: [0, 0, 160, 90] as const, y: 0.47 },
      inset: { src: 20, box: [100, 20, 300, 180] as const, y: 0.8 },
      lines: [{ text: "WORST CANDY" }, { text: "EVER MADE?" }]
    }
    const thumb = yield* artifacts.allocate(owner, "thumbnail")
    yield* artifacts.record(thumb, { data: { proposal: null, config, image: "thumbnail.jpg" }, path: join(thumb.relDir, "thumbnail.jpg") })

    const workspaces = yield* ShortWorkspaces
    return {
      ws: yield* workspaces.get(project.id),
      bold: yield* workspaces.checkThumbnail(project.id, config),
      tooMany: yield* workspaces.checkThumbnail(project.id, { ...config, lines: [{ text: "THE WORST CANDY EVER MADE" }, { text: "TRULY" }] }),
      inAd: yield* workspaces.checkThumbnail(project.id, { ...config, hero: { ...config.hero, src: 55 } })
    }
  }))

  assert.equal(ws.render?.render.durationS, 12.5)
  assert.match(ws.render?.media.video ?? "", /^projects\/[^/]+\/render\/v1\/[^/]+\.mp4$/, "relative to the Viral home, for the media route")
  assert.match(ws.render?.media.checkSheet ?? "", /render\/v1\/check\.png$/)
  assert.equal(ws.metadata?.metadata.title, "It Broke Him")
  assert.match(ws.metadata?.media.video ?? "", /^renders\/.+\.mp4$/, "found by name even though the library moved")
  assert.match(ws.metadata?.media.notes ?? "", /^renders\/.+\.md$/)
  assert.match(ws.metadata?.media.thumbnail ?? "", /^renders\/.+\.jpg$/, "the approved thumbnail next to the mp4")
  assert.equal(ws.metadata?.files.folder, join(home, "renders"))
  assert.equal(ws.folder, join(home, "projects", ws.project.id), "the short's own folder, for Show in Finder")
  assert.equal(ws.thumbnail?.thumbnail.image, "thumbnail.jpg")
  assert.equal(ws.source.rights, "unconfirmed")

  assert.deepEqual(bold, [], "a bold thumbnail may take 4–5 words")
  assert.ok(tooMany.some((p) => /the text is 6 words; use 2–5/.test(p)))
  assert.ok(inAd.some((p) => /the hero at 55\.0s is inside an excluded range/.test(p)))
  await rt.dispose()
})

test("a cut-down short's workspace carries what its sections are cut from, and an edit is checked before it's sent", async () => {
  const rt = ManagedRuntime.make(Layer.mergeAll(ShortWorkspaces.layer, Sources.layer, Projects.layer, Artifacts.layer, RunStore.layer))
  // a minute of speech, a word every half second, with an ad read in the last five seconds
  const words = Array.from({ length: 120 }, (_, i) => ({ w: `w${i}`, s: i * 0.5, e: i * 0.5 + 0.4 }))
  const { ws, narrated, good, refused } = await rt.runPromise(Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/cut" }, rights: "owned", rightsNote: null })
    const artifacts = yield* Artifacts
    const owner = { _tag: "Source", id: source.id } as const
    const tx = yield* artifacts.allocate(owner, "transcript")
    writeFileSync(join(tx.dir, "transcript.json"), JSON.stringify({
      source: "source.mp4",
      language: "en",
      segments: [{ start: 0, end: 59.9, text: words.map((w) => w.w).join(" "), words }]
    }))
    yield* artifacts.record(tx, { data: null, path: join(tx.relDir, "transcript.json") })
    yield* artifacts.record(yield* artifacts.allocate(owner, "ad-ranges"), {
      data: { ranges: [{ start: 55, end: 60, kind: "sponsor", evidence: "use code" }] },
      path: null
    })
    const projects = yield* Projects
    const cut = yield* projects.create({ sourceIds: [source.id], title: "Cut", approach: "cut-down", presetId: null, musicTrackId: null })
    const story = yield* projects.create({ sourceIds: [source.id], title: "Story", approach: "claim-interleaved", presetId: null, musicTrackId: null })
    const workspaces = yield* ShortWorkspaces
    const section = (beat: "hook" | "rising_action" | "payoff", start: number, end: number) => ({ beat, start, end, note: "n" })
    return {
      ws: yield* workspaces.get(cut.id),
      narrated: yield* workspaces.get(story.id),
      good: yield* workspaces.checkSections(cut.id, {
        hookText: "It worked",
        sections: [section("hook", 10, 15), section("rising_action", 18, 32), section("payoff", 38, 50)]
      }),
      refused: yield* workspaces.checkSections(cut.id, {
        hookText: null,
        sections: [section("payoff", 40, 50), section("hook", 45, 52), section("rising_action", 54, 58)]
      })
    }
  }))

  assert.equal(ws.cutSource?.videos[0]?.words.length, 120, "the long video's words, for nudging a section to them")
  assert.equal(ws.cutSource?.videos[0]?.sourceSeconds, 59.9)
  assert.deepEqual(ws.cutSource?.videos[0]?.excluded, [{ start: 55, end: 60 }])
  assert.deepEqual(ws.cutSource?.limits, { minSection: 0.8, total: [30, 120], hookWords: 8 })
  assert.equal(narrated.cutSource, null, "a narrated short isn't cut from the transcript")

  assert.deepEqual(good, [])
  const text = refused.join("\n")
  assert.match(text, /first section must be the hook/)
  assert.match(text, /sections 1 and 2 overlap/)
  assert.match(text, /excluded range \(55\.0–60\.0s\)/)
  await rt.dispose()
})
