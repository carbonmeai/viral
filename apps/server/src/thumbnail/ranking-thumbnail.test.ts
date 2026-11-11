import type { RankingPlan, Script, ShotPlan, ThumbnailDesign, ThumbnailProposal } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import {
  checkRankingDesign,
  checkRankingThumbnail,
  narratedRankingMoments,
  rankingDesignBrief,
  type RankingMoments,
  rankingMoments,
  rankingThumbnailBrief,
  tiltInset
} from "./ranking-thumbnail.ts"

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
const moments = rankingMoments(plan)!
const proposal = (hero: number, face: number | null, source = 1): ThumbnailProposal => ({
  background: { src: 0 },
  hero: { src: hero, source, crop: [0, 0, 1, 1], circle: null },
  face: face === null ? null : { src: face, source, crop: [0, 0, 1, 1] },
  lines: [{ text: "TOP 2", color: "yellow" }, { text: "ANIMAL COMEBACKS", color: "white" }]
})

test("the brief points the hero at #1's after and the inset at #1's before", () => {
  const brief = rankingThumbnailBrief(moments, true)
  assert.match(brief, /#1's AFTER \(V2 169\.0–173\.0s or V2 185\.0–196\.0s, video: 2\)/)
  assert.match(brief, /#1's BEFORE \(V2 6\.0–11\.0s\)/)
  assert.match(brief, /"TOP 2" in yellow/)
})

test("a ranking's thumbnail is #1's after with #1's before inset, from #1's video", () => {
  assert.deepEqual(checkRankingThumbnail(proposal(190, 8), moments), [])
  const wrong = checkRankingThumbnail(proposal(80, 190), moments).join("\n")
  assert.match(wrong, /the hero is #1's after/)
  assert.match(wrong, /the inset is #1's before/)
  assert.match(checkRankingThumbnail(proposal(190, 8, 0), moments).join("\n"), /the hero is #1's after/, "the wrong video")
  assert.match(checkRankingThumbnail(proposal(190, null), moments).join("\n"), /#1's before as the inset/)
})

test("the inset is tilted unless the config already tilts it", () => {
  const config = { source: "a.mp4", background: { src: 0 }, hero: { src: 1, y: 0.5 }, inset: { src: 2, y: 0.8 }, lines: [] }
  assert.equal(tiltInset(config).inset?.tilt, -8)
  assert.equal(tiltInset({ ...config, inset: { ...config.inset, tilt: 4 } }).inset?.tilt, 4)
})

// A narrated ranking of 3 from three videos: #1 (V3) has a b-roll shot early in its video and the reveal take at 200 s.
const real = (quote: string, start: number, end: number, source: number) => ({ _tag: "Real" as const, quote, start, end, source })
const said = (text: string) => ({ _tag: "Narration" as const, text })
const script: Script = {
  headline: null,
  beats: [
    said("These three animals had no chance. Number one had already given up."),
    said("Number three is Dolly, a matted dog."),
    real("She couldn't see.", 30, 32, 0),
    said("Number two, a blind cow."),
    real("We named her Halo.", 40, 42, 1),
    said("Number one is Dasher, a husky left to die."),
    real("He wouldn't even lift his head.", 12, 15, 2),
    said("Then everything changed."),
    real("Look at him now, he runs every day.", 200, 212, 2),
    { _tag: "Cta", question: "Which comeback got you?" }
  ]
}
const broll = (word: number, src: number, source: number) => ({ word, src, source, note: "", wordText: "", frame: null })
const clip = (start: number, end: number, source: number) => ({ start, end, quote: "", source, frame: null })
const shotPlan: ShotPlan = {
  // word 20 is after #2's real line (afterWord 18); #1's shots: V3 at 8 s and 60 s, and a V1 shot that isn't #1's
  shots: [broll(0, 5, 0), broll(10, 33, 0), broll(15, 44, 1), broll(20, 60, 2), broll(22, 8, 2), broll(24, 90, 0)],
  markers: [],
  highlights: [],
  inserts: [
    { ...clip(29.9, 32.2, 0), afterWord: 12, afterWordText: "dog." },
    { ...clip(39.9, 42.1, 1), afterWord: 18, afterWordText: "cow." },
    { ...clip(11.9, 15.3, 2), afterWord: 27, afterWordText: "die." }
  ],
  outro: [clip(199.9, 212.4, 2)],
  storyboard: null
}

test("a narrated ranking's #1: the reveal take is the after, #1's earliest b-roll from its video the before", () => {
  const found = narratedRankingMoments(script, shotPlan, 3, "Animals Who Came Back")
  assert.deepEqual(found, {
    count: 3,
    title: "Animals Who Came Back",
    label: "Dasher",
    source: 2,
    after: [{ start: 199.9, end: 212.4 }],
    before: [{ start: 8, end: 10.5 }, { start: 60, end: 62.5 }]
  })
  // without a shot plan (the shots stage hasn't run): the script's reveal, and #1's first real line as the before
  assert.deepEqual(narratedRankingMoments(script, null, 3, "x")?.before, [{ start: 12, end: 15 }])
  // no #1 entry: no adaptation
  assert.equal(narratedRankingMoments({ headline: null, beats: script.beats.slice(0, 5) }, null, 3, "x"), null)
})

test("the basic and the AI briefs and checks use a narrated ranking's #1 like a list ranking's", () => {
  const found = narratedRankingMoments(script, shotPlan, 3, "Animals Who Came Back")!
  assert.match(rankingThumbnailBrief(found, true), /#1's AFTER \(V3 199\.9–212\.4s, video: 3\)/)
  assert.match(rankingThumbnailBrief(found, true), /#1's BEFORE \(V3 8\.0–10\.5s or V3 60\.0–62\.5s\)/)
  assert.deepEqual(checkRankingThumbnail(proposal(205, 9, 2), found), [])
  assert.match(checkRankingThumbnail(proposal(9, 205, 2), found).join("\n"), /the hero is #1's after/)

  const brief = rankingDesignBrief(found, true)
  assert.match(brief, /the hero is #1's real AFTER \(V3 199\.9–212\.4s\)/)
  assert.match(brief, /#1's real BEFORE \(V3 8\.0–10\.5s or V3 60\.0–62\.5s\) beside the after/)
  const frame = (src: number, source = 2) => ({ src, source })
  const design = (hero: number, reactions: ReadonlyArray<number>): ThumbnailDesign => ({
    graphic: null,
    words: "TOP 1",
    hero: { ...frame(hero), what: "the husky running", dramatise: "glowing" },
    escalation: null,
    reactions: reactions.map((r) => ({ ...frame(r), look: "sad" })),
    person: "a husky",
    prop: null,
    background: "a field",
    celebrity: null
  })
  assert.deepEqual(checkRankingDesign(design(205, [9, 210]), found), [])
  const wrong = checkRankingDesign(design(9, [30, 210]), found).join("\n")
  assert.match(wrong, /the hero is #1's after: a second inside 199\.9–212\.4s/)
  assert.match(wrong, /one of the reactions is #1's before/)
})

test("a list ranking's moments carry its title and count", () => {
  const m: RankingMoments = moments
  assert.equal(m.title, "Ranking Animal Comebacks")
  assert.equal(m.count, 2)
  assert.equal(m.label, "Horse who gave up")
})
