import { Effect, Layer } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { VoicePreviews } from "../voice/voice-previews.ts"
import { UsageReport } from "./usage.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-usage-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

test("a recorded \"Try a line\" preview shows in Usage as ElevenLabs characters outside any short", async () => {
  const usage = await Effect.runPromise(Effect.gen(function*() {
    const previews = yield* VoicePreviews
    yield* previews.record("voice-1", "eleven_v4", 74)
    yield* previews.record("voice-2", "eleven_v4", 12)
    return yield* (yield* UsageReport).get(7)
  }).pipe(Effect.provide(Layer.mergeAll(VoicePreviews.layer, UsageReport.layer))))
  assert.equal(usage.elevenLabs.characters, 86)
  assert.deepEqual([usage.elevenLabs.previews, usage.elevenLabs.previewCharacters, usage.elevenLabs.takes], [2, 86, 0])
  assert.deepEqual(usage.elevenLabs.byModel, [{ model: "eleven_v4", characters: 86, takes: 0, previews: 2 }])
  assert.deepEqual(usage.elevenLabs.byShort, [])
  assert.equal(usage.elevenLabs.byDay.at(-1)?.characters, 86)
})
