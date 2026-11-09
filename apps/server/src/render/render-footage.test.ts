import type { Source, SourceId } from "@viral/contracts"
import { DateTime } from "effect"
import assert from "node:assert/strict"
import { test } from "node:test"
import { footageRows, footageWarning } from "./render-stage.ts"

const source = (title: string): Source => ({
  id: title as SourceId,
  origin: { _tag: "Url", url: "https://www.youtube.com/watch?v=x", scan: true },
  title,
  channel: "The Dodo",
  url: null,
  durationS: 200,
  rights: "unconfirmed",
  rightsNote: null,
  createdAt: DateTime.makeUnsafe(0),
  updatedAt: DateTime.makeUnsafe(0)
})
const piece = { path: "/p.mp4", start: 9, end: 16 }

test("the render gate says, per scanned video, how many clips were 1080p and why any weren't", () => {
  const footage = {
    piecesBySource: { "0": [piece] },
    videos: [
      { index: 0, source: source("Horse"), scan: true, pieces: [piece], height: 1080, scanHeight: 480, problem: null },
      { index: 1, source: source("Cow"), scan: true, pieces: [], height: null, scanHeight: 480, problem: "YouTube refused the 1080p pieces twice (403)" },
      { index: 2, source: source("Dog"), scan: true, pieces: [piece], height: 1080, scanHeight: 480, problem: null }
    ]
  }
  const rows = footageRows(footage, { "0": { pieces: 3, scan: 0 }, "1": { pieces: 0, scan: 3 }, "2": { pieces: 2, scan: 1 } })
  assert.deepEqual(rows, [
    { video: 0, title: "Horse", pieces: 1, height: 1080, scanHeight: 480, clips: 3, scanClips: 0, problem: null },
    { video: 1, title: "Cow", pieces: 0, height: null, scanHeight: 480, clips: 0, scanClips: 3, problem: "YouTube refused the 1080p pieces twice (403)" },
    { video: 2, title: "Dog", pieces: 1, height: 1080, scanHeight: 480, clips: 2, scanClips: 1, problem: "1 clip reached past the fetched pieces" }
  ])
  assert.equal(
    footageWarning(rows, true),
    "V2 (Cow) plays from the 480p reading copy: YouTube refused the 1080p pieces twice (403); " +
      "V3 (Dog) has 1 of 3 clips from the 480p reading copy: 1 clip reached past the fetched pieces. Look before approving."
  )
  assert.equal(footageWarning(rows.slice(0, 1), true), null, "every clip 1080p: nothing to warn about")
  assert.deepEqual(footageRows({ piecesBySource: undefined, videos: [] }, {}), [], "no scanned video, no rows")
})
