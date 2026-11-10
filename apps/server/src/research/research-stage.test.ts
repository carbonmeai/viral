import { type RunRequest, type RunUpdate, type Shortlist, type SourceId, type SourceSetId, youTubeUrl } from "@viral/contracts"
import { Effect, Layer, ManagedRuntime, Schema, Stream } from "effect"
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
import { Transcriber } from "../transcribe/transcriber.ts"
import { VideoSetOverviews } from "../video-sets/video-set-overview.ts"
import { VideoSets } from "../video-sets/video-sets.ts"
import { ElevenLabs } from "../voice/eleven-labs.ts"
import { researchNote, Researches } from "./researches.ts"
import { FAKE_YT_DLP } from "./testing/fake-youtube.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-research-"))
  process.env["VIRAL_HOME"] = home
  // YouTube is the fake yt-dlp answering from the rescues search log; no pause, no thumbnails
  process.env["VIRAL_YT_DLP"] = FAKE_YT_DLP
  process.env["VIRAL_YT_SPACING_MS"] = "0"
  process.env["VIRAL_YT_THUMBNAILS"] = "off"
})
after(() => {
  for (const name of ["VIRAL_YT_DLP", "VIRAL_YT_SPACING_MS", "VIRAL_YT_THUMBNAILS"]) delete process.env[name]
  rmSync(home, { recursive: true, force: true })
})

// Videos already in the library and read, so the set reads them without downloading anything.
const MATTED = "Si0P5CmgiwU"
const COTTON = "XMkilsT2Ahs"
const HORSE = "jP4vNf1VvJE"
const GROOM = "Es9D8Ozl5Jg"
// backups, not in the library
const DONKEY = "kxPGFEuhT4o"
const BUSY = "A3qhJbqA--k"

const pick = (video: string, part: string) => ({ video, part, why: "Before, care and after are all filmed.", moments: [{ label: "before", at: 5 }, { label: "care", at: 30 }, { label: "after", at: null }] })
const scores = { openLoop: 8, completionCompulsion: 7, universalRelatability: 9, shareability: 6 }

// The replayed agents. The research agent first picks an hour-long video and too few, then fixes that; a replacement
// keeps the others and puts the groomer's video in the spot. The set-story agent finds no after in the second video.
const asked: Array<AgentTask<Schema.Top>> = []
const replay = AgentSession.replay((task) => {
  asked.push(task)
  if (task.stage === "research") {
    if (task.message.includes("This is a replacement")) {
      return { summary: "Searched once more for a groomer.", picks: [pick(COTTON, "#3"), pick(GROOM, "#2"), pick(HORSE, "#1")], backups: [] }
    }
    const first = asked.filter((t) => t.stage === "research").length === 1
    return first
      ? { summary: "Searched by animal.", picks: [pick(MATTED, "#2"), pick("jBR63No8O7s", "#1")], backups: [] }
      : { summary: "Searched by animal, then by channel.", picks: [pick(MATTED, "#3: the matted dog"), pick(COTTON, "#2: the cotton ball"), pick(HORSE, "#1: the horse")], backups: [pick(DONKEY, "spare: the donkey"), pick(BUSY, "spare")] }
  }
  return {
    summary: "Three rescues, worst first.",
    videos: [{ video: 1, summary: "a" }, { video: 2, summary: "b", missing: "no after: it ends at the vet" }, { video: 3, summary: "c" }],
    beats: [1, 2, 3].map((video) => ({ video, beat: "result", start: 5, end: 15, summary: "it works", quotes: [{ text: "it worked", start: 10, end: 11 }] })),
    proposals: [
      { approach: "claim-interleaved", title: "Comebacks", hook: "?", why: "w", scores, videos: [1, 2] },
      { approach: "question-recap", title: "Which one", hook: "?", why: "w", scores, videos: [2, 3] },
      // the idea doesn't read as a ranking (a ranking idea's picks are held to the ranking vetting, which the skill run's
      // 8-minute matted dog wouldn't pass: shortlist-rules.test.ts covers that), so no proposal is one
      { approach: "story-recap", title: "Three Comebacks", hook: "?", why: "w", scores, videos: [1, 2, 3] }
    ]
  }
})

const runtime = () =>
  ManagedRuntime.make(
    Layer.mergeAll(
      RunManager.layer.pipe(
        Layer.provideMerge(PipelineStagesLive),
        Layer.provideMerge(Layer.mergeAll(RunStore.layer, Artifacts.layer, Sources.layer, Projects.layer, VideoSets.layer, replay, ElevenLabs.replay(() => new Uint8Array()), Transcriber.layer))
      ),
      Researches.layer,
      VideoSetOverviews.layer
    )
  )
type Runtime = ReturnType<typeof runtime>

// A YouTube video already in the library and read (as if its source run fetched, transcribed and looked at it).
const readVideo = (videoId: string) =>
  Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: youTubeUrl(videoId) }, rights: "owned", rightsNote: null })
    const artifacts = yield* Artifacts
    const owner = { _tag: "Source", id: source.id } as const
    yield* artifacts.record(yield* artifacts.allocate(owner, "source-video"), { data: null, path: "source.mp4" })
    const slot = yield* artifacts.allocate(owner, "transcript")
    const words = [{ w: "It", s: 10, e: 10.3 }, { w: "worked.", s: 10.3, e: 10.6 }]
    writeFileSync(join(slot.dir, "transcript.json"), JSON.stringify({ source: "v.mp4", language: "en", segments: [{ start: 10, end: 11, text: "It worked.", words }] }))
    yield* artifacts.record(slot, { data: null, path: join(slot.relDir, "transcript.json") })
    yield* artifacts.record(yield* artifacts.allocate(owner, "contact-sheet"), { data: { every: 5, cols: 8, rows: 8, frames: 0, sheets: [] }, path: null })
    yield* artifacts.record(yield* artifacts.allocate(owner, "ad-ranges"), { data: { ranges: [] }, path: null })
    return source.id
  })

// Follows a set run until it waits for you (returning the gate) or finishes.
const until = (rt: Runtime, setId: SourceSetId, from: "research" | "set-story" | null) =>
  rt.runPromise(Effect.gen(function*() {
    const runs = yield* RunManager
    const run = yield* runs.start({ _tag: "Set", id: setId }, from)
    return yield* follow(run.id)
  }))
// (events up to `afterSeq` were seen already: answering a gate follows on from it)
const follow = (runId: Parameters<RunManager["Service"]["subscribe"]>[0], afterSeq = 0) =>
  Effect.gen(function*() {
    const runs = yield* RunManager
    const updates = [...yield* runs.subscribe(runId, afterSeq).pipe(
      Stream.takeUntil((u: RunUpdate) => u._tag === "Event" && (u.event._tag === "RunFinished" || u.event._tag === "RequestRaised")),
      Stream.runCollect
    )]
    const last = updates.at(-1)
    if (last?._tag === "Event" && last.event._tag === "RequestRaised") return { _tag: "Gate" as const, request: last.event.request }
    if (last?._tag === "Event" && last.event._tag === "RunFinished") return { _tag: "Done" as const, run: last.event.run }
    throw new Error("the run neither waited nor finished")
  })
const shortlistOf = (request: RunRequest): Shortlist => {
  assert.equal(request.payload?._tag, "ShortlistGate")
  return request.payload._tag === "ShortlistGate" ? request.payload.shortlist : (undefined as never)
}

test("a research finds the videos, waits at the shortlist, and your approved list becomes the set's videos, read and storied", async () => {
  const rt = runtime()
  const library = await rt.runPromise(Effect.gen(function*() {
    return { matted: yield* readVideo(MATTED), cotton: yield* readVideo(COTTON), horse: yield* readVideo(HORSE), groom: yield* readVideo(GROOM) }
  }))
  const set = await rt.runPromise(VideoSets.use((sets) => sets.createResearch({ idea: "Animal rescue comebacks, before and after", videos: 3, length: "60" })))
  assert.deepEqual(set.sourceIds, [], "a research set starts with no videos")
  assert.equal(set.brief, "Animal rescue comebacks, before and after")

  // the research: one fix round (the hour-long video, too few), then the gate
  const gate = await until(rt, set.id, null)
  assert.equal(gate._tag, "Gate")
  if (gate._tag !== "Gate") return
  assert.equal(gate.request.title, "Download these videos?")
  const research = asked.filter((t) => t.stage === "research")
  assert.equal(research.length, 2)
  assert.match(research[0]!.message, /^The idea: Animal rescue comebacks, before and after\n\nVideos: exactly 3, plus up to 3 backups\.\n\nLength of the short: Up to 60 seconds/)
  assert.deepEqual(research[0]!.tools?.map((t) => t.name), ["search_youtube", "video_details"])
  assert.deepEqual(research[0]!.skills, ["finding-source-videos"])
  assert.equal(research[0]!.defaultModel, "haiku")
  assert.match(research[1]!.message, /"Buried Alive in Fur… This Dog’s Transformation Left Us Speechless" is 1:05:01 long/)
  assert.match(research[1]!.message, /the list has 2 videos; give exactly 3/)
  const list = shortlistOf(gate.request)
  assert.deepEqual(list.picks.map((p) => [p.videoId, p.title, p.channel, p.durationS]), [
    [MATTED, "Extremely Matted Dog Transforms To The Cutest Pup | The Dodo", "The Dodo", 481],
    [COTTON, "Dog So Matted She Looked Like a Walking Cotton Ball Gets Cutest Makeover | The Dodo", "The Dodo", 103],
    [HORSE, "Giant Rescue Horse Who Worked For 20 Years Finally Retires | The Dodo", "The Dodo", 198]
  ])
  assert.deepEqual(list.backups.map((b) => b.videoId), [DONKEY, BUSY])
  assert.equal(list.picks[0]!.uploadDate, "2026-02-07", "every pick was looked up before you saw it")
  // nothing is in the set (or the library) until you approve
  assert.deepEqual((await rt.runPromise(VideoSets.use((s) => s.get(set.id)))).sourceIds, [])

  // you check a bad change first, then approve the list with the cotton ball first
  const bad = await rt.runPromise(Researches.use((r) => r.checkEdit(set.id, { ...list, picks: [list.picks[0]!] })))
  assert.deepEqual(bad, ["Keep at least 2 videos; the list has 1."])
  const edited: Shortlist = { ...list, picks: [list.picks[1]!, list.picks[0]!, list.picks[2]!] }
  const done = await rt.runPromise(Effect.gen(function*() {
    const runs = yield* RunManager
    const seen = yield* (yield* RunStore).lastSeq(gate.request.runId)
    yield* runs.respond(gate.request.id, { _tag: "Edit", artifact: edited })
    return yield* follow(gate.request.runId, seen)
  }))
  assert.equal(done._tag, "Done")
  if (done._tag !== "Done") return
  assert.equal(done.run.status, "completed", done.run.error ?? "")

  // the set's videos are your order, reusing the library's videos; the set story ran across them
  const overview = await rt.runPromise(VideoSetOverviews.use((o) => o.get(set.id)))
  assert.deepEqual(overview.set.sourceIds, [library.cotton, library.matted, library.horse])
  assert.deepEqual(overview.shortlist?.picks.map((p) => p.sourceId), [library.cotton, library.matted, library.horse])
  assert.equal(overview.story?.proposals.length, 3)
  assert.match(asked.findLast((t) => t.stage === "set-story")!.message, /These videos were found on YouTube for that idea/)
  assert.doesNotMatch(asked.findLast((t) => t.stage === "set-story")!.message, /reads as a ranking/)
  assert.equal(overview.story?.proposals.find((p) => p.approach === "story-recap")?.sources.length, 3)
  assert.deepEqual(overview.members.map((m) => m.missing), [null, "no after: it ends at the vet", null])

  // Replace this video, with a backup: the donkey takes the matted dog's place (a library video, so it stays there)
  const swap = await rt.runPromise(Researches.use((r) => r.replace(set.id, library.matted, DONKEY, "")))
  assert.deepEqual(swap, { from: "set-story" })
  const afterSwap = await rt.runPromise(Effect.gen(function*() {
    const s = yield* (yield* VideoSets).get(set.id)
    const donkey = yield* (yield* Sources).get(s.sourceIds[1]!)
    return { s, donkey, latest: yield* (yield* Researches).latest(set.id) }
  }))
  assert.deepEqual([afterSwap.s.sourceIds[0], afterSwap.s.sourceIds[2]], [library.cotton, library.horse])
  assert.equal(afterSwap.donkey.rights, "unconfirmed")
  assert.equal(afterSwap.donkey.channel, "The Dodo")
  assert.equal(afterSwap.donkey.title, "Donkey With Overgrown Hooves Runs Free For The First Time | The Dodo Comeback Kids")
  assert.equal(afterSwap.donkey.rightsNote, researchNote("Animal rescue comebacks, before and after"))
  assert.equal((afterSwap.donkey.origin as { readonly url: string }).url, youTubeUrl(DONKEY))
  assert.deepEqual(afterSwap.latest._tag === "Some" ? afterSwap.latest.value.backups.map((b) => b.videoId) : null, [BUSY], "the backup is used up")
  await rt.runPromise(Sources.use((s) => s.get(library.matted)))

  // the donkey can't be downloaded either: no backup left after this one, and the donkey (added by the research) goes
  const donkeyId = afterSwap.s.sourceIds[1]!
  await rt.runPromise(Researches.use((r) => r.replace(set.id, donkeyId, BUSY, "")))
  const gone = await rt.runPromise(Effect.flip(Sources.use((s) => s.get(donkeyId))))
  assert.equal(gone._tag, "SourceNotFound")

  // Replace this video with no backup: the research searches again for that spot and waits for you
  const busyId: SourceId = (await rt.runPromise(VideoSets.use((s) => s.get(set.id)))).sourceIds[1]!
  const again = await rt.runPromise(Researches.use((r) => r.replace(set.id, busyId, null, "it needs the vet on camera")))
  assert.deepEqual(again, { from: "research" })
  const replaced = await until(rt, set.id, "research")
  assert.equal(replaced._tag, "Gate", replaced._tag === "Done" ? replaced.run.error ?? "" : "")
  if (replaced._tag !== "Gate") return
  const brief = asked.findLast((t) => t.stage === "research")!.message
  assert.match(brief, /This is a replacement/)
  assert.match(brief, new RegExp(`Find a new video for spot 2 \\(${BUSY}, "Huge Matted Dog Found In A Busy Intersection \\| The Dodo"\\): it needs the vet on camera`))
  assert.deepEqual(shortlistOf(replaced.request).picks.map((p) => p.videoId), [COTTON, GROOM, HORSE])
  const finished = await rt.runPromise(Effect.gen(function*() {
    const seen = yield* (yield* RunStore).lastSeq(replaced.request.runId)
    yield* (yield* RunManager).respond(replaced.request.id, { _tag: "Approve" })
    return yield* follow(replaced.request.runId, seen)
  }))
  assert.equal(finished._tag === "Done" ? finished.run.status : null, "completed")
  const final = await rt.runPromise(VideoSets.use((s) => s.get(set.id)))
  assert.deepEqual(final.sourceIds, [library.cotton, library.groom, library.horse])
  const busyGone = await rt.runPromise(Effect.flip(Sources.use((s) => s.get(busyId))))
  assert.equal(busyGone._tag, "SourceNotFound", "the replaced video the research added is gone")
  await rt.dispose()
})
