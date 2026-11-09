import type { RankingPlan } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import {
  changeCount,
  checkFrameMedia,
  draftOf,
  entryBlocks,
  listWhilePlaying,
  moveInOrder,
  moveRank,
  moveShotTo,
  nudgeShot,
  plainWarning,
  planFrame,
  rankColor,
  rankInk,
  removeEntry,
  shuffleAgain,
  shuffledOrder,
  totalSeconds
} from "./ranking-values.ts"

const shot = (role: "before" | "care" | "after", start: number, end: number) => ({
  role,
  start,
  end,
  framing: "window" as const,
  note: role,
  text: "",
  firstFrame: `frames/${role}-${start}-first.jpg`,
  lastFrame: `frames/${role}-${start}-last.jpg`
})
const entry = (rank: number, source: number, label: string) => ({
  rank,
  ...(source === 0 ? {} : { source }),
  label,
  emoji: "🐶",
  shots: [shot("before", 1, 4), shot("care", 10, 13), shot("after", 20, 25)]
})
const plan: RankingPlan = {
  title: { lead: "Ranking Animal ", accent: "Comebacks" },
  entries: [entry(1, 0, "Horse"), entry(2, 1, "Puppy"), entry(3, 2, "Cat"), entry(4, 3, "Lamb")],
  order: [3, 4, 2, 1],
  durationS: 44,
  maxSeconds: 180,
  storyboard: "storyboard.png",
  warnings: []
}

test("an edit starts from the plan without its words and frames", () => {
  const draft = draftOf(plan)
  assert.equal("text" in draft.entries[0]!.shots[0]!, false)
  assert.equal(draft.entries[1]!.source, 1)
  assert.equal(totalSeconds(draft), 44)
  assert.equal(changeCount(draft, draft), 0)
})

test("moving a rank swaps it with its neighbour, keeps play places, and #1 still plays last", () => {
  const draft = draftOf(plan)
  const up = moveRank(draft, 2, -1)
  assert.equal(up.entries.find((e) => e.label === "Puppy")!.rank, 1)
  assert.equal(up.entries.find((e) => e.label === "Horse")!.rank, 2)
  assert.equal(up.order.at(-1), 1)
  assert.deepEqual([...up.order].sort(), [1, 2, 3, 4])
  assert.equal(moveRank(draft, 1, -1), draft, "nothing above #1")
  assert.ok(changeCount(draft, up) >= 2)
})

test("removing an entry renumbers the ranks below it and the order follows", () => {
  const less = removeEntry(draftOf(plan), 2)
  assert.deepEqual(less.entries.map((e) => [e.label, e.rank]), [["Horse", 1], ["Cat", 2], ["Lamb", 3]])
  assert.deepEqual(less.order, [2, 3, 1])
})

test("the shuffle is the server's: #1 last, …2, 1, and another order when asked again", () => {
  assert.deepEqual(shuffledOrder([1, 2, 3, 4, 5], 1).slice(-2), [2, 1])
  assert.deepEqual(shuffledOrder([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 7).slice(-3), [3, 2, 1])
  const draft = draftOf(plan)
  const again = shuffleAgain(draft, 3)
  assert.notDeepEqual(again.order, draft.order)
  assert.equal(again.order.at(-1), 1)
  assert.deepEqual(moveInOrder(draft, 4, -1).order, [4, 3, 2, 1])
  assert.equal(moveInOrder(draft, 2, 1), draft, "#1 stays last")
})

test("the list fills in for every entry played up to the selected one", () => {
  const list = listWhilePlaying(draftOf(plan), 4)
  assert.deepEqual(list.map((l) => [l.rank, l.revealed]), [[1, false], [2, false], [3, true], [4, true]])
  assert.equal(rankColor(1, 4), "#F5C518")
  assert.equal(rankColor(4, 4), "#E8202A")
  assert.equal(rankColor(4, 10), "#FFFFFF")
  assert.equal(rankInk(2, 4), "#9A9AA3", "silver reads on a light surface")
  assert.equal(rankInk(4, 10), undefined)
})

test("a picked frame moves the shot keeping its length, and drops the plan's frame", () => {
  const moved = moveShotTo(draftOf(plan), 2, 0, 30)
  const s = moved.entries[1]!.shots[0]!
  assert.deepEqual([s.start, s.end, s.framing], [30, 33, undefined])
  assert.equal(planFrame(plan, 1, s, "first"), null)
  assert.equal(planFrame(plan, 1, plan.entries[1]!.shots[0]!, "first"), "frames/before-1-first.jpg")
  assert.equal(nudgeShot(draftOf(plan), 1, 0, "end", 0.5).entries[0]!.shots[0]!.end, 4.5)
  assert.equal(nudgeShot(draftOf(plan), 1, 0, "start", 5).entries[0]!.shots[0]!.start, 1, "a start can't pass the end")
})

test("render check frames and warnings in plain words", () => {
  assert.equal(checkFrameMedia("projects/p/render/v2/07-x.mp4", "/Users/x/.viral/projects/p/render/v2/checks/rank-1-shot-1-first.jpg"), "projects/p/render/v2/checks/rank-1-shot-1-first.jpg")
  const names = ["Horse video", "Puppy video", "Cat video"]
  assert.equal(
    plainWarning("#3 shot 3 (after, V3 28.2–35.6s): its first and last frames look like different scenes; check it shows the right animal throughout", (i) => names[i]!, true),
    "Look at #3's after (Cat video, 0:28.2): its first and last frames look like different scenes"
  )
  assert.doesNotMatch(plainWarning("something about V2", (i) => names[i]!, true), /V2/)
})

test("entries sit on the timeline in play order", () => {
  const blocks = entryBlocks(draftOf(plan))
  assert.deepEqual(blocks.map((b) => [b.rank, b.start, b.end]), [[3, 0, 11], [4, 11, 22], [2, 22, 33], [1, 33, 44]])
})
