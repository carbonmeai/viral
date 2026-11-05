import { Schema } from "effect"
import assert from "node:assert/strict"
import { test } from "node:test"
import { hasCandyFixture, readCandyJson } from "./testing/candy-fixture.ts"
import { Transcript } from "./transcript.ts"

const decode = Schema.decodeUnknownSync(Transcript, { onExcessProperty: "error" })

test("decodes the candy source and voiceover transcripts", { skip: !hasCandyFixture }, () => {
  const source = decode(readCandyJson("transcript.json"))
  const voiceover = decode(readCandyJson("vo_tx/transcript.json"))
  assert.equal(source.language, "en")
  assert.ok(source.segments[0]!.words.length > 0)
  assert.ok(voiceover.segments.length > 0)
})
