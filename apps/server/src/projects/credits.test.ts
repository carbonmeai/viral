import assert from "node:assert/strict"
import { test } from "node:test"
import { appearanceOrder, creditedChannels, creditLine, rankingSources } from "./credits.ts"

const sources = [
  { rights: "licensed", channel: "NileBlue" },
  { rights: "owned", channel: "Me" },
  { rights: "unconfirmed", channel: "Mark Rober" },
  { rights: "licensed", channel: "NileBlue" },
  { rights: "licensed", channel: null }
]

test("without a plan, credits each channel that isn't yours once, in video order", () => {
  assert.deepEqual(creditedChannels(sources), ["NileBlue", "Mark Rober"])
  assert.equal(creditLine(sources), "Video: NileBlue · Mark Rober")
  assert.equal(creditLine([{ rights: "licensed", channel: "NileBlue" }]), "Video: NileBlue", "one video reads as before")
  assert.equal(creditLine([{ rights: "owned", channel: "Me" }]), null)
})

test("with a plan, only the channels whose footage plays, in the order it first appears", () => {
  // V3 (Mark Rober) opens, V1 follows; V2 is yours and V4/V5 aren't used
  assert.equal(creditLine(sources, [2, 1, 0]), "Video: Mark Rober · NileBlue")
  assert.equal(creditLine(sources, [1]), null, "only your own footage plays")
  assert.equal(creditLine(sources, [4]), null, "a video with no channel can't be named")
})

test("a narrated short's videos appear by where their clips play; a cut-down short's by its sections", () => {
  const narrated = appearanceOrder({
    _tag: "Narrated",
    plan: {
      shots: [{ word: 4, source: 1 }, { word: 0, source: 2 }, { word: 9 }].map((s) => ({ ...s, src: 1, note: "", wordText: "w", frame: null })),
      // plays after word 3, before the shot on word 4
      inserts: [{ start: 1, end: 2, quote: "q", afterWord: 3, afterWordText: "w", source: 3, frame: null }],
      outro: [{ start: 1, end: 2, quote: "q", source: 4, frame: null }]
    }
  })
  assert.deepEqual(narrated, [2, 3, 1, 0, 4])
  const cut = appearanceOrder({
    _tag: "Cut",
    plan: { sections: [{ source: 1 }, {}, { source: 1 }].map((s) => ({ ...s, beat: "hook" as const, start: 0, end: 1, text: "t", note: "", frame: null })) }
  })
  assert.deepEqual(cut, [1, 0])
})

test("a ranking's videos appear in play order; its sources list each rank's channel and link, #1 first", () => {
  const entries = [
    { rank: 1, source: 2, label: "Horse who gave up" },
    { rank: 2, label: "Puppy walks again" },
    { rank: 3, source: 1, label: "My own cat" }
  ]
  assert.deepEqual(appearanceOrder({ _tag: "Ranking", plan: { entries: entries.map((e) => ({ ...e, emoji: "🐴", shots: [] })), order: [3, 2, 1] } }), [1, 0, 2])
  const videos = [
    { rights: "unconfirmed", channel: "The Dodo", url: "https://www.youtube.com/watch?v=a", title: "a" },
    { rights: "owned", channel: "Me", url: null, title: "b" },
    { rights: "unconfirmed", channel: "Hope For Paws", url: "https://www.youtube.com/watch?v=c", title: "c" }
  ]
  assert.deepEqual(rankingSources({ entries: entries.map((e) => ({ ...e, emoji: "🐴", shots: [] })) }, videos), [
    "#1 Horse who gave up: Hope For Paws, https://www.youtube.com/watch?v=c",
    "#2 Puppy walks again: The Dodo, https://www.youtube.com/watch?v=a",
    "#3 My own cat"
  ])
})
