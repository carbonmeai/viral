import { type CutPlan, CutRenderPlan } from "@viral/contracts"
import { Schema } from "effect"
import assert from "node:assert/strict"
import { test } from "node:test"
import { BUILT_IN_PRESETS } from "../presets/built-in-presets.ts"
import { assembleCut, type CutInput } from "./assemble-cut.ts"

const [recap, fullBleed] = BUILT_IN_PRESETS.map((p) => p.config)
const plan: CutPlan = {
  hookText: "This candy breaks your brain",
  sections: [
    { beat: "hook", start: 1993.5, end: 1996, note: "all the taste", text: "it literally is all the taste", frame: null },
    { beat: "conflict", start: 1374, end: 1380, cropX: 0.3, framing: "blur", note: "goo", text: "like napalm", frame: null }
  ],
  storyboard: null
}
const input = (preset: typeof recap): CutInput => ({
  slug: "03-cut",
  title: "The Candy That Broke His Brain",
  source: "/s/source.mp4",
  sourceTranscript: "/s/transcript.json",
  preset: preset!,
  plan,
  excluded: [{ start: 2158, end: 2270 }],
  credit: "Video: NileBlue"
})

test("the full-bleed style: cropped footage, the hook card, upper-case captions and the credit", () => {
  const out = assembleCut(input(fullBleed))
  Schema.decodeSync(CutRenderPlan)(out, { onExcessProperty: "error" })
  assert.equal(out.framing, "crop")
  assert.equal(out.hook_text, "This candy breaks your brain")
  assert.equal(out.caption_case, "upper")
  assert.equal(out.credit, "Video: NileBlue")
  assert.deepEqual(out.sections[1], { beat: "conflict", start: 1374, end: 1380, crop_x: 0.3, framing: "blur" })
  assert.deepEqual(out.exclude, [[2158, 2270]])
})

test("the recap style: a blurred fill, no hook card and no credit", () => {
  const out = assembleCut(input(recap))
  assert.equal(out.framing, "blur")
  assert.equal(out.hook_text, undefined)
  assert.equal(out.credit, undefined)
  assert.equal(out.caption_case, "lower")
})

test("a short from two videos lists V2 with its own excluded ranges, and a V2 section names it", () => {
  const two: CutPlan = {
    ...plan,
    sections: [...plan.sections, { beat: "payoff", start: 5, end: 9, source: 1, note: "the hand", text: "look at my hand", frame: null }]
  }
  const out = assembleCut({
    ...input(fullBleed),
    plan: two,
    others: [{ source: "/s2/source.mp4", sourceTranscript: "/s2/transcript.json", excluded: [{ start: 0, end: 3 }] }],
    credit: "Video: NileBlue · Heidi"
  })
  Schema.decodeSync(CutRenderPlan)(out, { onExcessProperty: "error" })
  assert.deepEqual(out.sources, [{ path: "/s2/source.mp4", transcript: "/s2/transcript.json" }])
  assert.deepEqual(out.exclude, [[2158, 2270]])
  assert.deepEqual(out.exclude_by_source, { "1": [[0, 3]] })
  assert.deepEqual(out.sections[2], { beat: "payoff", start: 5, end: 9, source: 1 })
  assert.ok(!("source" in out.sections[0]!), "a V1 section is written as before")
  assert.equal(out.credit, "Video: NileBlue · Heidi")
})

test("a single-video plan has no videos list or per-video ranges", () => {
  const out = assembleCut(input(fullBleed))
  assert.equal("sources" in out, false)
  assert.equal("exclude_by_source" in out, false)
})
