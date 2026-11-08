import type { Run, WaitingItem } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { homeStats, shortStatus, videoStatus, videosOf } from "./home-values.ts"

const run = (status: Run["status"]) => ({ status }) as Run
const waitingOn = (stage: string, sourceId = "candy") =>
  ({ request: { stage }, sourceId }) as unknown as WaitingItem

test("a short shows the step waiting for you, else its latest run", () => {
  assert.deepEqual(shortStatus(run("waiting"), waitingOn("shots")), { tone: "wait", label: "Shots" })
  assert.deepEqual(shortStatus(run("completed"), undefined), { tone: "ok", label: "Published" })
  assert.deepEqual(shortStatus(run("running"), undefined), { tone: "run", label: "Running" })
  assert.deepEqual(shortStatus(run("interrupted"), undefined), { tone: "neutral", label: "Paused" })
  assert.deepEqual(shortStatus(undefined, undefined), { tone: "neutral", label: "Not started" })
})

test("a video is processing, mapped or just added", () => {
  assert.equal(videoStatus(run("running"), false).label, "Processing")
  assert.equal(videoStatus(run("completed"), true).label, "Story mapped")
  assert.equal(videoStatus(undefined, false).label, "Added")
})

test("the stat row counts across videos and shorts", () => {
  const stats = homeStats({
    waiting: [waitingOn("shots", "candy"), waitingOn("voice", "podcast")],
    videos: [{ status: { tone: "ok", label: "Story mapped" } }, { status: { tone: "run", label: "Processing" } }],
    shorts: [{ status: { tone: "ok", label: "Published" } }, { status: { tone: "wait", label: "Shots" } }, { status: { tone: "neutral", label: "Not started" } }]
  })
  assert.deepEqual(stats.waiting, { value: 2, sub: "across 2 videos" })
  assert.deepEqual(stats.videos, { value: 2, sub: "1 mapped · 1 processing" })
  assert.deepEqual(stats.shorts, { value: 3, sub: "1 published · 1 waiting" })
})

test("a short's row names its video, or every one of several by its short name", () => {
  const sources = [
    { id: "candy", title: "He made the world's most extreme candy" },
    { id: "heidi", title: "Heidi Klum as severed hand in 25th anniversary of iconic Halloween party" }
  ]
  assert.equal(videosOf({ sourceIds: ["candy"] } as never, sources as never), "He made the world's most extreme candy")
  assert.equal(videosOf({ sourceIds: ["candy", "heidi"] } as never, sources as never), "Extreme candy · Heidi Klum")
  assert.equal(videosOf({ sourceIds: ["gone"] } as never, sources as never), null)
})
