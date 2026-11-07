import assert from "node:assert/strict"
import { test } from "node:test"
import { ageLabel, compactCount, flagOf, initials, languageName, pickerVoices, splitName, useCaseLabel, voiceLine, voiceTraits } from "./voices-values.ts"

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

test("voice labels read as words, who it sounds like first", () => {
  const adam = { category: "premade", labels: { use_case: "conversational", gender: "male", language: "en", accent: "american", age: "middle_aged" } }
  assert.equal(voiceTraits(adam), "Middle-aged · American · English · Conversational · Male")
  assert.equal(voiceTraits({ category: null, labels: { use_case: "narrative_story", descriptive: "deep" } }), "Deep · Narration")
  assert.equal(voiceTraits({ category: null, labels: { use_case: "social_media" } }), "Social media")
  assert.equal(voiceTraits({ category: null, labels: { use_case: "informative_educational", age: "young" } }), "Young · Educational")
  assert.equal(voiceTraits({ category: null, labels: { use_case: "characters_animation" } }), "Characters")
  assert.equal(voiceTraits({ category: null, labels: { use_case: "entertainment_tv" } }), "Entertainment")
  assert.equal(voiceTraits({ category: null, labels: { accent: "british", language: "en-GB" } }), "British · British English")
  assert.equal(voiceTraits({ category: "professional", labels: {} }), "Professional clone")
  assert.equal(voiceTraits({ category: null, labels: {} }), "")
})

test("the line under a name: the traits in the name, then the labels", () => {
  assert.equal(voiceLine({ name: "Marvin - Audiobooks", category: null, labels: { gender: "male" } }), "Audiobooks · Male")
  assert.equal(voiceLine({ name: "Marvin - Audiobooks", category: null, labels: {} }), "Audiobooks")
  assert.equal(voiceLine({ name: "Adam - Dominant, Firm", category: null, labels: { descriptive: "deep", gender: "male" } }), "Dominant, Firm · Male")
  assert.equal(voiceLine({ name: "Adam", category: null, labels: { descriptive: "deep", gender: "male" } }), "Deep · Male")
  assert.equal(voiceLine({ name: "Adam", category: null, labels: { gender: "male" } }), "Male")
})

test("the picker puts the current voice first and searches names and words", () => {
  const v = (voiceId: string, name: string, labels: Record<string, string> = {}) => ({ voiceId, name, category: null, labels })
  const list = [v("a", "Adam", { accent: "american" }), v("b", "Bella", { accent: "british" }), v("c", "Callum", { use_case: "narrative_story" })]
  assert.deepEqual(pickerVoices(list, "b", "").map((x) => x.voiceId), ["b", "a", "c"])
  assert.deepEqual(pickerVoices(list, "b", "narration").map((x) => x.voiceId), ["c"])
  assert.deepEqual(pickerVoices(list, "b", " AMER ").map((x) => x.voiceId), ["a"])
})
