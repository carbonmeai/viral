import type { RankingPlan, ThumbnailProposal } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { checkRankingThumbnail, rankingThumbnailBrief, tiltInset } from "./ranking-thumbnail.ts"

const shot = (role: "before" | "care" | "after", start: number, end: number) =>
  ({ role, start, end, framing: "window" as const, note: role, text: "", firstFrame: null, lastFrame: null })
const plan: RankingPlan = {
  title: { lead: "Ranking Animal ", accent: "Comebacks" },
  entries: [
    { rank: 2, label: "Puppy", emoji: "🐶", shots: [shot("before", 1, 4), shot("care", 10, 13), shot("after", 20, 25)] },
    { rank: 1, source: 1, label: "Horse who gave up", emoji: "🐴", shots: [shot("before", 6, 11), shot("care", 74, 79), shot("after", 169, 173), shot("after", 185, 196)] }
  ],
  order: [2, 1],
  durationS: 40,
  maxSeconds: 180,
  storyboard: null,
  warnings: []
}
const proposal = (hero: number, face: number | null, source = 1): ThumbnailProposal => ({
  background: { src: 0 },
  hero: { src: hero, source, crop: [0, 0, 1, 1], circle: null },
  face: face === null ? null : { src: face, source, crop: [0, 0, 1, 1] },
  lines: [{ text: "TOP 2", color: "yellow" }, { text: "ANIMAL COMEBACKS", color: "white" }]
})

test("the brief points the hero at #1's after and the inset at #1's before", () => {
  const brief = rankingThumbnailBrief(plan, true)
  assert.match(brief, /#1's AFTER \(V2 169\.0–173\.0s or V2 185\.0–196\.0s, video: 2\)/)
  assert.match(brief, /#1's BEFORE \(V2 6\.0–11\.0s\)/)
  assert.match(brief, /"TOP 2" in yellow/)
})

test("a ranking's thumbnail is #1's after with #1's before inset, from #1's video", () => {
  assert.deepEqual(checkRankingThumbnail(proposal(190, 8), plan), [])
  const wrong = checkRankingThumbnail(proposal(80, 190), plan).join("\n")
  assert.match(wrong, /the hero is #1's after/)
  assert.match(wrong, /the inset is #1's before/)
  assert.match(checkRankingThumbnail(proposal(190, 8, 0), plan).join("\n"), /the hero is #1's after/, "the wrong video")
  assert.match(checkRankingThumbnail(proposal(190, null), plan).join("\n"), /#1's before as the inset/)
})

test("the inset is tilted unless the config already tilts it", () => {
  const config = { source: "a.mp4", background: { src: 0 }, hero: { src: 1, y: 0.5 }, inset: { src: 2, y: 0.8 }, lines: [] }
  assert.equal(tiltInset(config).inset?.tilt, -8)
  assert.equal(tiltInset({ ...config, inset: { ...config.inset, tilt: 4 } }).inset?.tilt, 4)
})
