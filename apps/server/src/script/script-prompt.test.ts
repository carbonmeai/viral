import assert from "node:assert/strict"
import { test } from "node:test"
import { buildScriptPrompt, SCRIPT_WRITER_PROMPT } from "./script-prompt.ts"

test("the stage prompt names the tool and defers to the skills", () => {
  assert.match(SCRIPT_WRITER_PROMPT, /`propose_script`/)
  assert.match(SCRIPT_WRITER_PROMPT, /approach\s+skill/)
})

test("the stage prompt asks for the whole story, set-ups the real lines answer, whole sentences, and no closing beat", () => {
  assert.match(SCRIPT_WRITER_PROMPT, /cover the story's stages in order/)
  assert.match(SCRIPT_WRITER_PROMPT, /write the set-up it\s+answers/)
  assert.match(SCRIPT_WRITER_PROMPT, /whole sentences: it starts on a sentence's first word and ends on a sentence's last word/)
  assert.match(SCRIPT_WRITER_PROMPT, /the closing question is\s+not one of its beats/)
})

test("the brief carries the video, its excluded ranges and the timed transcript", () => {
  const prompt = buildScriptPrompt({
    title: "Extreme candy",
    channel: "NileBlue",
    transcript: "[0.0–2.2] This video has been sponsored by Brilliant.",
    excluded: [{ start: 0, end: 3 }],
    angle: { title: "Every taste", hook: "This candy hits every taste at once", why: "a list of reactions" }
  })
  assert.match(prompt, /Video: Extreme candy \(by NileBlue\)/)
  assert.match(prompt, /Never use these ranges.*0–3s/)
  assert.match(prompt, /\[0\.0–2\.2\] This video/)
  assert.match(prompt, /hook: This candy hits every taste at once/)
})

test("the creator's brief comes first when the short has one, and not at all when it doesn't", () => {
  const input = {
    title: "Extreme candy",
    channel: "NileBlue",
    transcript: "[0.0–2.2] This video has been sponsored by Brilliant.",
    excluded: [{ start: 0, end: 3 }],
    angle: { title: "Every taste", hook: "This candy hits every taste at once", why: "a list of reactions" }
  }
  const withBrief = buildScriptPrompt({ ...input, creatorBrief: "Focus on the friend's reactions." })
  assert.ok(withBrief.startsWith("The creator's brief for this short: Focus on the friend's reactions."))
  for (const none of [null, "   ", undefined]) {
    assert.doesNotMatch(buildScriptPrompt((none === undefined ? input : { ...input, creatorBrief: none })), /creator's brief/)
  }
})

test("a short from several videos: each video labelled with its ads and transcript; long ones as outlines", () => {
  const w = (word: string, s: number) => ({ w: word, s, e: s + 0.3 })
  const transcript = (text: string, start: number) => ({
    source: "x",
    language: "en",
    segments: [{ start, end: start + 1, text, words: text.split(" ").map((x, i) => w(x, start + i * 0.3)) }]
  })
  const input = {
    title: "Extreme candy",
    channel: "NileBlue",
    transcript: "unused",
    excluded: [],
    angle: { title: "Why it hurts", hook: "A chemist explains", why: "the science behind the faces" },
    creatorBrief: "The candy, then the chemist.",
    videos: [
      { title: "Extreme candy", channel: "NileBlue", seconds: 600, transcript: transcript("It's like glue.", 100), excluded: [] },
      { title: "Acid explained", channel: "ChemLab", seconds: 300, transcript: transcript("Pure citric acid.", 5), excluded: [{ start: 50, end: 60, kind: "sponsor" }] }
    ],
    beats: [{ source: 1, beat: "result" as const, start: 4, end: 8, summary: "the chemist names the acid", quotes: [{ text: "Pure citric acid.", start: 5, end: 6 }] }]
  }
  const prompt = buildScriptPrompt(input)
  assert.ok(prompt.startsWith("The creator's brief for this short: The candy, then the chemist."))
  assert.match(prompt, /- V1 "Extreme candy" \(NileBlue, 10:00\)\n- V2 "Acid explained" \(ChemLab, 5:00\)/)
  assert.match(prompt, /\[V1 100\.0–101\.0\] It's like glue\./)
  assert.match(prompt, /Excluded ranges in V2 .*50–60s \(sponsor\)/)
  assert.match(prompt, /\[V2 4\.0–8\.0\] result: the chemist names the acid "Pure citric acid\." \(5\.0s\)/)
  assert.match(prompt, /`video`: its V number/)
  assert.doesNotMatch(prompt, /outline/i)

  const long = "word ".repeat(40_000).trim()
  const outlined = buildScriptPrompt({ ...input, videos: input.videos.map((v) => ({ ...v, transcript: transcript(long, 0) })) })
  assert.match(outlined, /Outline of V1/)
  assert.match(outlined, /search_transcript/)
})
