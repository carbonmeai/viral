import assert from "node:assert/strict"
import { test } from "node:test"
import { footageLines, footageSummary } from "./footage-values.ts"

const row = { video: 0, title: "Horse who gave up", pieces: 3, height: 1080, scanHeight: 480, clips: 4, scanClips: 0, problem: null }

test("found videos read from 480p copies show their 1080p pieces, and a fallback is said plainly", () => {
  assert.deepEqual(footageLines([row], false), [{ video: "Horse who gave up", quality: "1080p · 4 clips", problem: null }])
  assert.equal(footageSummary([row]), "All 1080p")
  const blocked = { ...row, video: 1, title: "Blind cow", pieces: 0, height: null, clips: 0, scanClips: 3, problem: "YouTube refused the 1080p pieces twice (403)" }
  assert.deepEqual(footageLines([row, blocked], true), [
    { video: "V1 · Horse who gave up", quality: "1080p · 4 clips", problem: null },
    { video: "V2 · Blind cow", quality: "480p reading copy · 3 clips", problem: "YouTube refused the 1080p pieces twice (403)" }
  ])
  assert.equal(footageSummary([row, blocked]), "1 of 2 videos in 480p")
  // some clips reached past the pieces
  assert.deepEqual(footageLines([{ ...row, clips: 3, scanClips: 1 }], false)[0], {
    video: "Horse who gave up",
    quality: "480p reading copy · 1 of 4 clips",
    problem: "its 1080p pieces didn't cover them"
  })
})
