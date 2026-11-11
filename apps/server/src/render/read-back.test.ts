import type { NarratedPlan, ReadBack, ReadBackCheck, TranscriptWord } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import {
  align,
  cutReadBackPlan,
  narratedReadBackPlan,
  norm,
  parseSilences,
  rankingReadBackPlan,
  readBack,
  readBackChatChecks,
  readBackNote,
  type ReadBackPlan,
  sourceText
} from "./read-back.ts"

// words laid out one every 0.4 s from `from`
const timed = (text: string, from = 0, step = 0.4): ReadonlyArray<TranscriptWord> =>
  text.split(" ").map((w, i) => ({ w, s: from + i * step, e: from + i * step + 0.3 }))

const byKind = (checks: ReadonlyArray<ReadBackCheck>, kind: ReadBackCheck["kind"]) => checks.filter((c) => c.kind === kind)
const warnings = (checks: ReadonlyArray<ReadBackCheck>) => checks.filter((c) => !c.ok)

// The take: story narration (0–6 s, word 0–15), a skipped line, more narration, then the closing line (from 10 s).
const TAKE = [
  ...timed("He tried the candy. It burned his mouth for an hour. Then he made another one.", 0),
  ...timed("He said it hurt.", 6.4),
  ...timed("The second batch was perfect.", 8.0),
  ...timed("Would you try it? Tell us in the comments, and subscribe for more.", 10.4)
]
// V1: whole sentences with a pause between them, so the real line below is "It's on fire. I can't feel my tongue."
const SOURCE = [
  ...timed("Okay here goes.", 100),
  ...timed("It's on fire. I can't feel my tongue.", 110),
  ...timed("Next time less pepper.", 120)
]
const PLAN: NarratedPlan = {
  slug: "x",
  source: "v.mp4",
  voiceover: "vo.wav",
  voiceover_transcript: "vo.json",
  shots: [],
  narration_end: 10.3,
  // after "hour." (word 10) the clip plays; the narration resumes at "Then" (word 11)
  inserts: [{ start: 109.95, end: 112.95, after_word: 10 }],
  outro: [],
  cta: { question: "Would you try it?", vo_start: 10.4, vo_end: 15.5 }
}
const sources = new Map([[0, sourceText(SOURCE)]])

test("the plan reads as the renderer plays it: narration, the clip, narration, the closing line", () => {
  const rb = narratedReadBackPlan(PLAN, TAKE, sources, { closingWanted: true, countdown: null, durationS: 20 })
  assert.deepEqual(rb.pieces.map((p) => p.kind), ["narration", "real", "narration", "closing"])
  assert.equal(rb.pieces[1]!.words.join(" "), "It's on fire. I can't feel my tongue.")
  assert.equal(rb.pieces[1]!.startsMid, null)
  assert.equal(rb.pieces[1]!.endsMid, null)
  assert.equal(rb.closing, "spoken")
})

// What the finished short says when everything is right: the narration, the clip, the rest, the closing line.
const heardOk = [
  ...timed("He tried the candy. It burned his mouth for an hour.", 0),
  ...timed("It's on fire. I can't feel my tongue.", 4.2),
  ...timed("Then he made another one. He said it hurt. The second batch was perfect.", 7.6),
  ...timed("Would you try it? Tell us in the comments and subscribe for more.", 14)
]

test("a short that reads back as planned passes every check", () => {
  const rb = narratedReadBackPlan(PLAN, TAKE, sources, { closingWanted: true, countdown: null, durationS: 20 })
  const checks = readBack(rb, heardOk, [])
  assert.deepEqual(warnings(checks), [])
  assert.ok(byKind(checks, "closing")[0]!.at! >= 14)
  assert.match(byKind(checks, "heard")[0]!.text, /100%/)
})

test("a real line cut mid-sentence in its video is a warning with where it ends", () => {
  // the clip stops after "fire." … no: after "I can't", in the middle of the second sentence
  const plan = { ...PLAN, inserts: [{ start: 109.95, end: 111.75, after_word: 10 }] }
  const rb = narratedReadBackPlan(plan, TAKE, sources, { closingWanted: true, countdown: null, durationS: 20 })
  assert.equal(rb.pieces[1]!.endsMid, "feel my tongue.")
  const cut = byKind(readBack(rb, heardOk, []), "real-line")
  assert.equal(cut.length, 1)
  assert.equal(cut[0]!.ok, false)
  assert.match(cut[0]!.text, /Real line 1 stops mid-sentence \(the sentence goes on: “feel my tongue\.”\)/)
  assert.ok(cut[0]!.at !== null)
  // and one starting inside a sentence
  const late = narratedReadBackPlan({ ...PLAN, inserts: [{ start: 111.55, end: 112.95, after_word: 10 }] }, TAKE, sources, { closingWanted: true, countdown: null, durationS: 20 })
  assert.match(byKind(readBack(late, heardOk, []), "real-line")[0]!.text, /starts mid-sentence \(it leaves out “I” before it\)/)
})

test("a missing closing question: not heard, the subscribe line gone, or none in the short at all", () => {
  const rb = narratedReadBackPlan(PLAN, TAKE, sources, { closingWanted: true, countdown: null, durationS: 20 })
  const noClosing = heardOk.filter((w) => w.s < 14)
  const silentEnd = byKind(readBack(rb, noClosing, []), "closing")[0]!
  assert.equal(silentEnd.ok, false)
  assert.match(silentEnd.text, /isn't heard clearly/)

  const noAsk = [...noClosing, ...timed("Would you try it? Tell us in the comments.", 14)]
  assert.match(byKind(readBack(rb, noAsk, []), "closing")[0]!.text, /not the subscribe line/)

  // the style wants one, the plan has none
  const { cta: _, ...withoutCta } = PLAN
  const none = narratedReadBackPlan(withoutCta, TAKE, sources, { closingWanted: true, countdown: null, durationS: 20 })
  assert.equal(none.closing, "missing")
  const missing = byKind(readBack(none, heardOk, []), "closing")[0]!
  assert.equal(missing.ok, false)
  assert.match(missing.text, /has none/)

  // the switch off: no closing check at all
  const off = narratedReadBackPlan(withoutCta, TAKE, sources, { closingWanted: false, countdown: null, durationS: 20 })
  assert.deepEqual(byKind(readBack(off, heardOk, []), "closing"), [])
})

test("a skipped line that is heard anyway is a warning; one that isn't passes", () => {
  // "He said it hurt." (words 16–19) is voiced but skipped: the clip after word 15 resumes at "The" (word 20)
  const plan: NarratedPlan = { ...PLAN, inserts: [...PLAN.inserts!, { start: 119.95, end: 121.5, after_word: 15, resume_word: 20 }] }
  const rb = narratedReadBackPlan(plan, TAKE, sources, { closingWanted: true, countdown: null, durationS: 22 })
  assert.equal(rb.skipped.length, 1)
  assert.equal(rb.skipped[0]!.words.join(" "), "He said it hurt.")
  const clean = [
    ...timed("He tried the candy. It burned his mouth for an hour.", 0),
    ...timed("It's on fire. I can't feel my tongue.", 4.2),
    ...timed("Then he made another one.", 7.6),
    ...timed("Next time less pepper.", 9.6),
    ...timed("The second batch was perfect.", 11.4),
    ...timed("Would you try it? Tell us in the comments and subscribe for more.", 14)
  ]
  const ok = byKind(readBack(rb, clean, []), "skipped")
  assert.deepEqual(ok.map((c) => c.ok), [true])
  const leaky = [...clean.slice(0, -18), ...timed("He said it hurt.", 10.8), ...clean.slice(-18)].sort((a, b) => a.s - b.s)
  const heard = readBack(rb, leaky, [])
  const skipped = byKind(heard, "skipped")
  assert.equal(skipped[0]!.ok, false)
  assert.match(skipped[0]!.text, /A skipped line is heard: “He said it hurt\.”/)
  assert.ok(Math.abs(skipped[0]!.at! - 10.8) < 0.01)
  // the extra words are the skipped line's, not a second warning about the join
  assert.deepEqual(byKind(heard, "join").filter((c) => !c.ok), [])
})

test("a garbled join and narration that isn't heard are warnings at their moment", () => {
  const rb = narratedReadBackPlan(PLAN, TAKE, sources, { closingWanted: true, countdown: null, durationS: 20 })
  const garbled = [
    ...timed("He tried the candy. It burned his mouth for an", 0),
    ...timed("bzz grr", 3.6),
    ...timed("on fire. I can't feel my tongue.", 4.6),
    // "made another one" is missing in the middle of the narration
    ...timed("Then he. He said it hurt. The second batch was perfect.", 7.6),
    ...timed("Would you try it? Tell us in the comments and subscribe for more.", 14)
  ]
  const checks = readBack(rb, garbled, [])
  const join = byKind(checks, "join")[0]!
  assert.equal(join.ok, false)
  assert.match(join.text, /The join from the narration into real line 1 doesn.t read cleanly/)
  assert.match(join.text, /lost “hour \| its”/)
  assert.match(join.text, /heard “bzz grr” instead/)
  assert.ok(Math.abs(join.at! - 3.9) < 0.01)
  const narration = byKind(checks, "narration")[0]!
  assert.equal(narration.ok, false)
  assert.match(narration.text, /“made another one”/)
})

test("a narrated ranking's countdown: in order passes, out of order or missing is a warning", () => {
  const rb: ReadBackPlan = { pieces: [], skipped: [], closing: null, countdown: 3, silentTail: 0, durationS: 30 }
  // the hook teases "number one" first; that's not the countdown
  const inOrder = timed("Number one had given up. Number three is Dolly. Number 2 is Halo. #1 is Dasher.")
  const ok = byKind(readBack(rb, inOrder, []), "countdown")
  assert.deepEqual(ok.map((c) => c.ok), [true])
  assert.match(ok[0]!.text, /#3 0:02\.0, #2 0:03\.6, #1 0:05\.2/)

  const swapped = timed("Number three is Dolly. Number one is Dasher. Number two is Halo.")
  const bad = byKind(readBack(rb, swapped, []), "countdown")
  assert.equal(bad[0]!.ok, false)
  assert.match(bad[0]!.text, /“Number 1” comes out of order/)

  const gap = timed("Number three is Dolly. Number one is Dasher.")
  assert.match(byKind(readBack(rb, gap, []), "countdown")[0]!.text, /“Number 2” isn't heard/)
})

test("silence over 1.2 s is a warning, except a cut-down's silent end card", () => {
  const sections = [{ beat: "hook" as const, start: 109.95, end: 112.95 }]
  const plan = cutReadBackPlan({ slug: "x", source: "v", transcript: "t", framing: "crop", sections, cta: { question: "Would you?" } }, sources, { closingWanted: true, durationS: 7 })
  assert.equal(plan.closing, "card")
  const heard = timed("It's on fire. I can't feel my tongue.", 0)
  const checks = readBack(plan, heard, [[3.4, 7]])
  assert.deepEqual(byKind(checks, "silence").map((c) => c.ok), [true])
  assert.equal(byKind(checks, "closing")[0]!.ok, true)
  const gap = readBack(plan, heard, [[1.2, 3.0], [3.4, 7]])
  const silence = byKind(gap, "silence")
  assert.equal(silence.length, 1)
  assert.equal(silence[0]!.ok, false)
  assert.equal(silence[0]!.text, "Silent for 1.8 s")
  assert.equal(silence[0]!.at, 1.2)
  // shorter than the floor is fine
  assert.deepEqual(byKind(readBack(plan, heard, [[1.2, 2.0]]), "silence").map((c) => c.ok), [true])
})

test("a list ranking reads every entry's clips in playing order", () => {
  const plan = rankingReadBackPlan({
    slug: "r",
    title: ["Ranking ", "Things"],
    order: [2, 1],
    videos: [{ path: "a" }],
    items: [
      { rank: 1, label: "B", emoji: "", shots: [{ source: 0, src: 119.95, dur: 1.6, framing: "fill" }] },
      { rank: 2, label: "A", emoji: "", shots: [{ source: 0, src: 99.95, dur: 1.3, framing: "fill" }] }
    ]
  }, sources, 4)
  assert.deepEqual(plan.pieces.map((p) => p.label), ["#2 clip 1", "#1 clip 1"])
  const checks = readBack(plan, [...timed("Okay here goes.", 0), ...timed("Next time less pepper.", 1.5)], [])
  assert.deepEqual(warnings(checks), [])
})

test("words compare without case, punctuation or spelt-out numbers, and a long word may be a letter off", () => {
  assert.equal(norm("It's"), "its")
  assert.equal(norm("5."), "five")
  const matched = align(["capsaicin", "is", "five"], ["capsacin", "is", "five"])
  assert.deepEqual(Array.from(matched), [0, 1, 2])
})

test("silencedetect's lines become stretches; one still open runs to the end", () => {
  const out = "frame:1\nlavfi.silence_start=1.5\nframe:2\nlavfi.silence_end=3.25\nlavfi.silence_duration=1.75\nlavfi.silence_start=9\n"
  assert.deepEqual(parseSilences(out, 10), [[1.5, 3.25], [9, 10]])
})

test("the chat's render card: each check with its moment, and a sentence on how the read-back went", () => {
  const heard: ReadBack = {
    provider: "whisper-local",
    seconds: 7.4,
    transcript: "/t.json",
    problem: null,
    checks: [
      { kind: "narration", ok: true, text: "The narration reads as written (12 words)", at: null },
      { kind: "silence", ok: false, text: "Silent for 1.8 s", at: 3.5 }
    ]
  }
  assert.deepEqual(readBackChatChecks(heard), [
    { text: "The narration reads as written (12 words)", ok: true },
    { text: "Silent for 1.8 s", ok: false, at: 3.5 }
  ])
  assert.equal(readBackNote(heard), " I read the finished short back (local Whisper, 7 s): 1 thing to look at before approving.")
  assert.equal(readBackNote({ ...heard, checks: heard.checks.slice(0, 1) }), " I read the finished short back (local Whisper, 7 s): everything it should say is there.")
  assert.equal(readBackNote({ ...heard, checks: [], problem: "turned off (VIRAL_READ_BACK=off)" }), " The finished short wasn't read back: turned off (VIRAL_READ_BACK=off).")
  assert.equal(readBackNote(undefined), "")
  assert.deepEqual(readBackChatChecks(undefined), [])
})
