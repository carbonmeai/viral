import { Schema } from "effect"
import assert from "node:assert/strict"
import { test } from "node:test"
import { hasCandyFixture, readCandyJson } from "./testing/candy-fixture.ts"
import { ThumbConfig } from "./thumb-config.ts"

const decode = Schema.decodeUnknownSync(ThumbConfig, { onExcessProperty: "error" })

test("decodes the candy thumb.json with no unknown keys", { skip: !hasCandyFixture }, () => {
  const thumb = decode(readCandyJson("shorts/01-every-taste-candy.thumb.json"))
  assert.deepEqual(thumb.lines.map((line) => line.text), ["7 TASTES", "1 CANDY"])
})
