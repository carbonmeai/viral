import { Schema } from "effect"
import assert from "node:assert/strict"
import { test } from "node:test"
import { NarratedPlan } from "./narrated-plan.ts"
import { hasCandyFixture, readCandyJson } from "./testing/candy-fixture.ts"

// onExcessProperty: "error" makes the test fail if narrated.json uses a key the schema doesn't model.
const decode = Schema.decodeUnknownSync(NarratedPlan, { onExcessProperty: "error" })

test("decodes the candy narrated.json with no unknown keys", { skip: !hasCandyFixture }, () => {
  const plan = decode(readCandyJson("narrated.json"))
  assert.equal(plan.slug, "01-every-taste-candy")
  assert.ok(plan.shots.length > 0)
  assert.equal(typeof plan.music, "object")
})

test("rejects a shot without a source time", () => {
  assert.throws(() =>
    decode({ slug: "x", source: "s.mp4", voiceover: "vo.wav", voiceover_transcript: "t.json", shots: [{ at: 0 }] })
  )
})
