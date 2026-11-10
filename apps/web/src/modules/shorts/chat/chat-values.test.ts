import type { ChatEntry, ChatItem, RunRequest } from "@viral/contracts"
import { DateTime } from "effect"
import assert from "node:assert/strict"
import { test } from "node:test"
import { chipsFor, composerState, emptyThread, foldChat, gateState, shortModel, whoAnswers } from "./chat-values.ts"

const at = DateTime.makeUnsafe("2026-11-10T12:00:00Z")
const entry = (seq: number, item: ChatItem, requestId: string | null = null): ChatEntry =>
  ({ id: `c${seq}`, seq, role: "app", stage: null, runId: null, stageRunId: null, requestId, item, createdAt: at }) as ChatEntry
const gate = entry(2, { _tag: "Gate", stage: "script", title: "Approve the script?" }, "r1")

test("folding: the snapshot, then each new item once", () => {
  const first = foldChat(emptyThread, { _tag: "Snapshot", items: [entry(1, { _tag: "Earlier", text: "x" }), gate], lastSeq: 2 })
  assert.equal(first.loaded, true)
  const next = foldChat(first, { _tag: "Item", entry: entry(3, { _tag: "Approved", stage: "script", how: "approve" }, "r1") })
  assert.equal(next.items.length, 3)
  assert.equal(foldChat(next, { _tag: "Item", entry: entry(3, { _tag: "Approved", stage: "script", how: "approve" }, "r1") }), next)
})

test("a gate card is open while its request waits, then approved or replaced by the next draft", () => {
  const pending = { id: "r1" } as RunRequest
  assert.equal(gateState(gate, [gate], pending), "open")
  const approved = [gate, entry(3, { _tag: "Approved", stage: "script", how: "approve" }, "r1")]
  assert.equal(gateState(gate, approved, null), "approved")
  const asked = [gate, entry(3, { _tag: "YouSaid", step: "script", text: "punchier", action: { _tag: "Revise", stage: "script" } }, "r1")]
  assert.equal(gateState(gate, asked, null), "replaced")
})

test("chips are typed per step and format", () => {
  const ctx = { format: "narrated" as const, videos: ["Candy", "Heidi"], otherVoice: { id: "g", name: "George" }, hasSong: true, entries: 5 }
  assert.deepEqual(chipsFor("script", ctx).map((c) => c.label), ["Make the hook punchier", "Use more of Heidi", "Swap the music", "Shorter, under 40s"])
  assert.ok(chipsFor("script", ctx).some((c) => "open" in c && c.open === "music-picker"))
  assert.deepEqual(chipsFor("voice", ctx).find((c) => c.label === "Try George's voice"), { label: "Try George's voice", act: { _tag: "SetVoice", voiceId: "g" } })
  assert.deepEqual(chipsFor("music", ctx).find((c) => c.label === "No music"), { label: "No music", act: { _tag: "Refit", trackId: null } })
  assert.deepEqual(chipsFor("music", { ...ctx, format: "ranking" }), [])
  const back = chipsFor("render", { ...ctx, format: "ranking" })[0]!
  assert.ok("act" in back && back.act._tag === "SendBack" && back.act.to === "moments")
  assert.equal(chipsFor("moments", ctx)[0]!.label, "Swap #2 and #3")
  assert.equal(chipsFor("moments", { ...ctx, entries: 2 })[0]!.label, "Swap #1 and #2")
})

test("the composer waits on agent steps the run hasn't reached; steps without an agent always take a message", () => {
  assert.equal(composerState("script", "waiting").enabled, true)
  assert.equal(composerState("script", "done").enabled, true)
  assert.deepEqual(composerState("shots", "next"), { enabled: false, why: "Opens when the run gets here." })
  assert.equal(composerState("shots", "running").enabled, false)
  assert.equal(composerState("moments", "running", true).enabled, true, "a waiting gate always takes a note")
  assert.equal(composerState("music", "next").enabled, true)
})

test("who answers: the step's agent on its route, or the small agent on Haiku", () => {
  assert.equal(whoAnswers("music", null).who, "Agent")
  assert.deepEqual(whoAnswers("script", null), { who: "Script agent", how: "Claude CLI", billing: "on your plan" })
  assert.equal(shortModel("claude-haiku-5-5"), "Haiku 5.5")
  assert.equal(shortModel("anthropic/claude-haiku-5.5"), "Haiku 5.5")
})
