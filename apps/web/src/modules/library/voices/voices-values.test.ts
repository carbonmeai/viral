import assert from "node:assert/strict"
import { test } from "node:test"
import { ageLabel, compactCount, flagOf, initials, languageName, splitName, useCaseLabel } from "./voices-values.ts"

test("counts read the way ElevenLabs shows them", () => {
  assert.deepEqual([87, 4900, 10_000, 252_800, 559_600, 1_200_000].map(compactCount), ["87", "4.9K", "10K", "252.8K", "559.6K", "1.2M"])
})

test("age is the coarsest unit that fits", () => {
  const now = Date.UTC(2026, 10, 7)
  const ago = (days: number) => (now - days * 86_400_000) / 1000
  assert.deepEqual([800, 400, 150, 21, 3, 0].map((d) => ageLabel(ago(d), now)), ["2y", "1y", "5mo", "3w", "3d", "today"])
  assert.equal(ageLabel(null, now), null)
})

test("languages, flags, names and use cases", () => {
  assert.equal(languageName("en"), "English")
  assert.equal(languageName("pt"), "Portuguese")
  assert.equal(flagOf("en-US"), "🇺🇸")
  assert.equal(flagOf("en"), null)
  assert.deepEqual(splitName("Marvin - Audiobooks - Warm"), { name: "Marvin", traits: "Audiobooks - Warm" })
  assert.equal(initials("Oliver Silk - Deep Gravel Narrative"), "OS")
  assert.equal(useCaseLabel("narrative_story"), "Narration")
  assert.equal(useCaseLabel("news_reading"), "News reading")
})
