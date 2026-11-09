import { RankingRenderPlan, type PresetConfig, type RankingPlan } from "@viral/contracts"
import { Schema } from "effect"
import assert from "node:assert/strict"
import { test } from "node:test"
import { assembleRanking } from "./assemble-ranking.ts"

const shot = (role: "before" | "care" | "after", start: number, end: number, framing: "window" | "fill" = "window") =>
  ({ role, start, end, framing, note: role, text: "", firstFrame: null, lastFrame: null })
const plan: RankingPlan = {
  title: { lead: "Ranking Animal ", accent: "Comebacks" },
  entries: [
    { rank: 2, label: "Puppy walks again", emoji: "🐶", shots: [shot("before", 0.4, 3.9), shot("care", 25, 28.04), shot("after", 145, 149.5)] },
    { rank: 1, source: 1, label: "Horse who gave up", emoji: "🐴", shots: [{ ...shot("before", 6, 11, "fill"), cropX: 0.4 }, shot("care", 74, 79), shot("after", 184.95, 196.55)] }
  ],
  order: [2, 1],
  durationS: 40,
  maxSeconds: 180,
  storyboard: null,
  warnings: []
}
const preset = { canvas: [1080, 1920], loudnessLufs: -14, credit: true } as unknown as PresetConfig

test("the moments become the ranking renderer's plan: each shot from its entry's video, no via line unless the style says", () => {
  const out = assembleRanking({
    slug: "07-top-2",
    plan,
    preset,
    videos: [
      { path: "/v/a.mp4", transcript: "/v/a.json", excluded: [{ start: 155.5, end: 178 }], channel: "Animal Aid Unlimited" },
      { path: "/v/b.mp4", transcript: "/v/b.json", excluded: [], channel: null }
    ]
  })
  assert.ok(Schema.is(RankingRenderPlan)(out))
  assert.deepEqual(out.title, ["Ranking Animal ", "Comebacks"])
  assert.deepEqual(out.order, [2, 1])
  assert.deepEqual(out.items[0]!.shots[1], { source: 0, src: 25, dur: 3.04, framing: "window" })
  assert.deepEqual(out.items[1]!.shots[0], { source: 1, src: 6, dur: 5, framing: "fill", crop_x: 0.4 })
  assert.equal(out.items[0]!.channel, "Animal Aid Unlimited")
  assert.equal(out.items[1]!.channel, undefined, "your own footage names no channel")
  assert.deepEqual(out.exclude_by_source, { "0": [[155.5, 178]] })
  assert.equal(out.via, false)
  assert.equal(out.lufs, -14)
  assert.equal(assembleRanking({ slug: "x", plan, preset: { ...preset, rankingVia: true }, videos: [] }).via, true)
})
