import type { WaitingItem } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { actionLabel, scopeWaiting, videosSpanned, waitingSub, waitingTitle } from "./waiting.ts"

const item = (stage: string, sourceId: string, project: { title: string; number: number } | null): WaitingItem =>
  ({
    request: { stage } as WaitingItem["request"],
    owner: { _tag: project ? "Project" : "Source", id: "x" } as WaitingItem["owner"],
    sourceId: sourceId as WaitingItem["sourceId"],
    sourceTitle: sourceId === "candy" ? "Extreme candy" : "A podcast",
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
