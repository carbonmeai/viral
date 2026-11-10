import type { ThumbConfig } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { defaultVoiceLine, guessCategory, SAMPLE_LINE, soundCost, soundLength, soundPrompt, thumbnailPlan, voiceCheck } from "./generator-values.ts"

const config = {
  layout: "bold",
  source: "candy.mp4",
  background: { src: 10 },
  hero: { src: 1542, box: [0, 0, 100, 100] },
  lines: [{ text: "WHAT DOES IT" }, { text: "TAKE" }]
} as unknown as ThumbConfig

test("the thumbnail: properties only at the gate redraw it with no agent; a prompt or a new hero is a note", () => {
  const props = { layout: "bold" as const, arrow: false }
  assert.deepEqual(thumbnailPlan({ config, prompt: "", props, hero: null, atGate: true })._tag, "Nothing")
  const redraw = thumbnailPlan({ config, prompt: "", props: { layout: "bold", arrow: true }, hero: null, atGate: true })
  assert.equal(redraw._tag, "Redraw")
  assert.equal(redraw._tag === "Redraw" && redraw.config.arrow, true)
  assert.equal(redraw._tag === "Redraw" && redraw.config.lines.length, 2, "the rest of it is kept")
  assert.deepEqual(thumbnailPlan({ config, prompt: "  Bigger face, angrier  ", props, hero: null, atGate: true }), { _tag: "Note", note: "Bigger face, angrier." })
  assert.deepEqual(thumbnailPlan({ config, prompt: "", props, hero: { source: 0, t: 1542, name: "Candy" }, atGate: true }), {
    _tag: "Note",
    note: "Use Candy 25:42 as the hero."
  })
  // after approval there's no gate to redraw at: the properties become the note of a redo
  assert.deepEqual(thumbnailPlan({ config, prompt: "", props: { layout: "classic", arrow: true }, hero: null, atGate: false }), {
    _tag: "Note",
    note: "Use the classic layout. Add an arrow."
  })
  assert.deepEqual(thumbnailPlan({ config, prompt: "More red", props: { layout: "bold", arrow: true }, hero: { source: 1, t: 41, name: "Heidi" }, atGate: true }), {
    _tag: "Note",
    note: "More red. Use Heidi 0:41 as the hero. Add an arrow."
  })
})

test("a designed voice speaks the script's first lines, enough for ElevenLabs, and says what it'll cost", () => {
  const lines = ["One candy engineer wanted a candy hitting every taste.", "Sweet, sour, salty, bitter, umami, spicy and cold, all at once.", "It took three years."]
  assert.equal(defaultVoiceLine(lines), `${lines[0]} ${lines[1]}`)
  assert.ok(defaultVoiceLine(lines).length >= 100)
  assert.equal(defaultVoiceLine(["Too short."]), SAMPLE_LINE)
  assert.equal(defaultVoiceLine([]), SAMPLE_LINE)
  assert.deepEqual(voiceCheck("A warm, fast American narrator in his thirties.", SAMPLE_LINE), { problem: null, characters: SAMPLE_LINE.length, cost: `about ${SAMPLE_LINE.length} characters` })
  assert.match(voiceCheck("deep", SAMPLE_LINE).problem ?? "", /Describe the voice/)
  assert.match(voiceCheck("A warm, fast American narrator in his thirties.", "Hi").problem ?? "", /at least 100 characters \(it has 2\)/)
})

test("a sound effect: its kind from the words, the hints in the prompt, the song's bar as its length, and its cost", () => {
  assert.equal(guessCategory("A short whoosh that swells into a deep bass hit"), "riser")
  assert.equal(guessCategory("Record scratch"), "scratch")
  assert.equal(guessCategory("Camera shutter"), "camera")
  assert.equal(guessCategory("Something nice"), "whoosh")
  const hints = { atWord: { word: "But", t: 19.8 }, song: { title: "Viral drop", bpm: 117.5 } }
  assert.equal(
    soundPrompt("A short whoosh into a bass hit.", hints),
    "A short whoosh into a bass hit. It lands on the spoken word “But”, with the hit at the very end. In time with music at 117.5 BPM."
  )
  assert.equal(soundPrompt("Pop", { atWord: null, song: null }), "Pop.")
  assert.equal(soundLength(null, hints), 2, "one bar at 117.5 BPM")
  assert.equal(soundLength(2.5, hints), 2.5, "your length wins")
  assert.equal(soundLength(null, { atWord: null, song: null }), null)
  assert.equal(soundLength(90, hints), 30)
  assert.equal(soundCost(1.5, 2), "about 30 credits")
  assert.equal(soundCost(null, 1), "about 50 credits")
})
