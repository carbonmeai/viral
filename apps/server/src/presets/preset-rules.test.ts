import assert from "node:assert/strict"
import { test } from "node:test"
import { BUILT_IN_PRESETS } from "./built-in-presets.ts"
import { checkPresetConfig, checkPresetName } from "./preset-rules.ts"

test("the built-in styles pass their own checks", () => {
  for (const preset of BUILT_IN_PRESETS) assert.deepEqual(checkPresetConfig(preset.config), [], preset.name)
})

test("out-of-range and malformed values are each reported", () => {
  const base = BUILT_IN_PRESETS[1]!.config
  const problems = checkPresetConfig({
    ...base,
    headline: { colors: ["red", "#FFFFFF"], y: 0.9, size: 0.13 },
    captions: { ...base.captions, y: 1.2, maxWords: 9, highlight: "yellow" },
    loudnessLufs: -2,
    voice: { ...base.voice, voiceId: " ", wordsPerSecond: 8 }
  }).join("\n")
  assert.match(problems, /headline line 1's colour must be a colour/)
  assert.match(problems, /headline's position must be 0–0.5/)
  assert.match(problems, /captions' position must be 0.1–0.95/)
  assert.match(problems, /words per caption must be 1–6/)
  assert.match(problems, /caption highlight must be a colour/)
  assert.match(problems, /loudness must be -30–-6/)
  assert.match(problems, /narrator's pace must be 2–5/)
  assert.match(problems, /needs a voice/)
})

test("one-word captions can't show several words, and names are checked", () => {
  const base = BUILT_IN_PRESETS[0]!.config
  assert.match(checkPresetConfig({ ...base, captions: { ...base.captions, mode: "word", maxWords: 3 } }).join(), /1 word at a time/)
  assert.deepEqual(checkPresetName("  Bold red  "), [])
  assert.deepEqual(checkPresetName(" "), ["the style needs a name"])
  assert.match(checkPresetName("x".repeat(41)).join(), /under 40/)
})
