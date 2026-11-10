import type { Run, StageRun } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { BLOCKED_MESSAGE, failedOnItsOwn, memberState, plainMemberError, proposalMoment, proposalVideos, reorder, setPhase, shortVideoName, videoColor, sourceNames, videoLabel, videoNames } from "./set-values.ts"

const run = (status: Run["status"], error: string | null = null) => ({ status, error }) as Run
const stage = (name: StageRun["stage"], status: StageRun["status"]) => ({ stage: name, status, attempt: 1 }) as StageRun

test("videos are spelled out by place with a colour each, the same for the same position", () => {
  assert.equal(videoLabel(0), "Video 1")
  assert.equal(videoLabel(9), "Video 10")
  assert.equal(new Set(Array.from({ length: 10 }, (_, i) => videoColor(i))).size, 10)
  assert.equal(videoColor(1), videoColor(11))
})

test("a video's short name: a name in its title, else its first meaningful words, else its place", () => {
  assert.equal(shortVideoName("Heidi Klum as severed hand in 25th anniversary of iconic Halloween party", 1), "Heidi Klum")
  assert.equal(shortVideoName("Making the world's most powerful Red Bull", 1), "Red Bull")
  assert.equal(shortVideoName("He made the world’s most extreme candy", 0), "Extreme candy")
  assert.equal(shortVideoName("candy.mp4", 0), "Candy")
  assert.equal(shortVideoName("How I Built The Biggest Lego Set Ever", 0), "Biggest Lego Set")
  assert.equal(shortVideoName("Supercalifragilisticexpialidocious", 0), "Supercalifragilis…")
  assert.equal(shortVideoName(null, 1), "Video 2")
  assert.equal(shortVideoName("  the of  ", 2), "Video 3")
  for (const t of ["Heidi Klum as severed hand in 25th anniversary of iconic Halloween party", "A very long title with many many words in it"]) {
    assert.ok(shortVideoName(t, 0).length <= 18)
  }
})

test("two videos whose short names match are spelled out instead", () => {
  assert.deepEqual(videoNames(["candy", "Heidi Klum at Halloween", null]), ["Candy", "Heidi Klum", "Video 3"])
  assert.deepEqual(videoNames(["Extreme candy part 1", "Extreme candy part 2"]), ["Extreme candy 1", "Extreme candy 2"])
  assert.deepEqual(videoNames(["The candy", "Candy!"]), ["Video 1", "Video 2"])
  // a name you gave wins, and a made-up name that clashes with it is spelled out
  assert.deepEqual(videoNames(["Extreme candy", "Heidi Klum at Halloween"], [null, "Heidi"]), ["Extreme candy", "Heidi"])
  assert.deepEqual(videoNames(["Candy", "Heidi Klum"], [null, "candy"]), ["Video 1", "candy"])
  assert.deepEqual(sourceNames([{ title: "candy", shortName: "  " }, { title: null, shortName: "Big John" }, null]), ["Candy", "Big John", "Video 3"])
})

test("a set's video: being read with its step, read, stopped, or not started", () => {
  const reading = memberState({ ready: false }, run("running"), [stage("source", "reused"), stage("transcribe", "running")])
  assert.deepEqual(reading, { _tag: "reading", step: "Transcribing", done: 1, of: 4 })
  assert.deepEqual(memberState({ ready: true }, run("completed"), []), { _tag: "ready" })
  assert.deepEqual(memberState({ ready: true }, null, []), { _tag: "ready" })
  assert.deepEqual(memberState({ ready: false }, run("failed", "transcribe (x): no audio"), []), { _tag: "failed", error: "transcribe (x): no audio" })
  assert.deepEqual(memberState({ ready: false }, null, []), { _tag: "waiting" })
})

test("the set reads its videos, then proposes", () => {
  assert.equal(setPhase(run("running"), [], false), "reading")
  assert.equal(setPhase(run("running"), [stage("set-story", "running")], false), "proposing")
  assert.equal(setPhase(run("completed"), [stage("set-story", "succeeded")], true), "proposed")
  assert.equal(setPhase(run("failed"), [], false), "stopped")
  assert.equal(setPhase(null, [], false), "new")
  assert.deepEqual(proposalVideos([2, 0, 2]), [0, 2])
})

test("each proposal card shows a different moment: its own video and beat where the story has them", () => {
  const beat = (source: number, start: number) => ({ source, start })
  const story = {
    beats: [beat(0, 1), beat(0, 20), beat(1, 5), beat(1, 30), beat(2, 7)],
    proposals: [{ sources: [0, 1] }, { sources: [0, 1] }, { sources: [1, 2] }]
  }
  assert.deepEqual(proposalMoment(story, 0), { source: 0, t: 1 })
  assert.deepEqual(proposalMoment(story, 1), { source: 1, t: 30 })
  assert.deepEqual(proposalMoment(story, 2), { source: 1, t: 5 })
  // a video with no beat falls to the next one it uses; no beats at all, no moment
  assert.deepEqual(proposalMoment({ beats: [beat(1, 9)], proposals: [{ sources: [0, 1] }] }, 0), { source: 1, t: 9 })
  assert.equal(proposalMoment({ beats: [], proposals: [{ sources: [0, 1] }] }, 0), null)
})

test("dragging a video moves it to its new place, the others closing up", () => {
  assert.deepEqual(reorder(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"])
  assert.deepEqual(reorder(["a", "b", "c", "d"], 3, 0), ["d", "a", "b", "c"])
  const same = ["a", "b"]
  assert.equal(reorder(same, 1, 1), same)
  assert.equal(reorder(same, 0, 5), same)
})

test("a video's failure in plain words, and Replace only for a video that failed on its own", () => {
  assert.equal(
    plainMemberError("source (blocked): YouTube refused the download twice (403). Viral doesn't work around a block: try again later, or replace this video."),
    BLOCKED_MESSAGE
  )
  assert.equal(plainMemberError("source (download): ERROR: [youtube] 3cbMd4i4DGk: Video unavailable"), "The download didn't finish: Video unavailable")
  assert.equal(plainMemberError("source (download): ERROR: \r[download] Got error: [Errno 32] Broken pipe"), "The download didn't finish: Got error: [Errno 32] Broken pipe")
  assert.equal(plainMemberError("transcribe (failed): no speech found"), "no speech found")
  assert.equal(plainMemberError("It stopped before it finished."), "It stopped before it finished.")
  assert.ok(failedOnItsOwn(run("failed", "source (blocked): …")))
  assert.ok(!failedOnItsOwn(run("cancelled")))
  assert.ok(!failedOnItsOwn(run("interrupted")))
  assert.ok(!failedOnItsOwn(null))
})
