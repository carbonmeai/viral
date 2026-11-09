import assert from "node:assert/strict"
import { test } from "node:test"
import { appearanceOrder, creditedChannels, creditLine } from "./credits.ts"

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
