import type { WaitingItem } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { actionLabel, scopeWaiting, videosSpanned, waitingSub, waitingTarget, waitingTitle } from "./waiting.ts"

const item = (stage: string, sourceId: string, project: { title: string; number: number } | null): WaitingItem =>
  ({
    request: { stage } as WaitingItem["request"],
    owner: { _tag: project ? "Project" : "Source", id: "x" } as WaitingItem["owner"],
    sourceId: sourceId as WaitingItem["sourceId"],
    sourceTitle: sourceId === "candy" ? "Extreme candy" : "A podcast",
    setId: null,
    setTitle: null,
    projectId: project ? ("p" as WaitingItem["projectId"]) : null,
    projectTitle: project?.title ?? null,
    projectNumber: project?.number ?? null
  })

test("waiting rows read like the mockup, globally and per video", () => {
  const shots = item("shots", "candy", { title: "He Made a Candy", number: 2 })
  const voice = item("voice", "podcast", { title: "One habit", number: 1 })
  assert.equal(waitingTitle(shots), "02 · He Made a Candy")
  assert.equal(waitingSub(shots, true), "Extreme candy · Shots step")
  assert.equal(waitingSub(shots, false), "Shots step")
  // a short from several videos names them all
  assert.equal(waitingSub(shots, true, "Extreme candy · Heidi Klum"), "Extreme candy · Heidi Klum · Shots step")
  assert.equal(actionLabel(shots), "Approve the shots")
  assert.equal(scopeWaiting([shots, voice], null).length, 2)
  assert.deepEqual(scopeWaiting([shots, voice], "candy"), [shots])
  assert.equal(videosSpanned([shots, voice]), 2)
  assert.equal(waitingTitle(item("story", "candy", null)), "Extreme candy")
})

test("a research's shortlist waits under its video set and opens the set", () => {
  const shortlist: WaitingItem = {
    ...item("research", "candy", null),
    owner: { _tag: "Set", id: "s" } as WaitingItem["owner"],
    sourceId: null,
    sourceTitle: null,
    setId: "s" as WaitingItem["setId"],
    setTitle: "Top 5 animal rescue comebacks"
  }
  assert.equal(waitingTitle(shortlist), "Top 5 animal rescue comebacks")
  assert.equal(waitingSub(shortlist, true), "Found from an idea · Shortlist step")
  assert.equal(actionLabel(shortlist), "Approve the shortlist")
  assert.deepEqual(waitingTarget(shortlist), { _tag: "Set", setId: "s" })
  assert.equal(videosSpanned([shortlist, item("shots", "candy", { title: "x", number: 1 })]), 1)
  assert.deepEqual(scopeWaiting([shortlist], "candy"), [])
})
