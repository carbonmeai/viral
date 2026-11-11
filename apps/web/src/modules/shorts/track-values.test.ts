import type { Script } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { rankingCues, sectionCues } from "./caption-cues.ts"
import { layoutTimeline } from "./editor-values.ts"
import { countdownOf } from "./script/countdown-values.ts"
import type { RankingDraft } from "./ranking/ranking-values.ts"
import type { EditSection } from "./sections/sections-values.ts"
import { timelineShots, shotSpans } from "./shots/shots-values.ts"
import { clipAt, type NarratedTracks, rulerStep, sameTarget, type ShortTimeline, tracksFor, type TrackVideo, visibleTracks } from "./track-values.ts"

const video = (id: string, name: string, color: string): TrackVideo => ({ id, name, title: null, color })
const candyHeidi = [video("candy", "Extreme candy", "blue"), video("heidi", "Heidi", "orange")]
const lane = (timeline: ShortTimeline, id: string) => timeline.tracks.find((t) => t.id === id)!

// Candy + Heidi: two narrated lines, a real line from Heidi after the first, an outro line from Candy
const words = ["One", "candy", "hits", "every", "taste.", "Heidi", "wore", "a", "hand."].map((w, i) => ({ w, s: i * 0.5, e: i * 0.5 + 0.4 }))
const script: Script = {
  headline: null,
  beats: [
    { _tag: "Narration", text: "One candy hits every taste." },
    { _tag: "Real", quote: "It's my left hand.", start: 30, end: 32, source: 1 },
    { _tag: "Narration", text: "Heidi wore a hand." },
    { _tag: "Real", quote: "This is so nasty.", start: 2038, end: 2040.2 }
  ]
}
const layout = layoutTimeline(script, words, 4.5)
const plan = { shots: [{ word: 0, source: 0 }, { word: 2, source: 0 }, { word: 5, source: 1 }, { word: 7, source: 0 }] }
const shotBlocks = timelineShots(shotSpans(plan as unknown as Parameters<typeof shotSpans>[0], words, 4.5), layout)

const narrated = (music: NarratedTracks["music"]) =>
  tracksFor({
    format: "narrated",
    videos: candyHeidi,
    captions: { cues: [{ start: 0, end: 1, text: "ONE CANDY HITS" }], from: "words" },
    layout,
    beats: script.beats,
    shots: { blocks: shotBlocks, sourceOf: (k) => plan.shots[k]!.source, frameOf: (k) => `shot-${k}.jpg` },
    realFrame: (kind, index) => `${kind}-${index}.jpg`,
    voiceUrl: "vo.wav",
    music
  })

test("a narrated short: a lane per video with its own shots and real lines, then voice, music and captions", () => {
  const timeline = narrated({ _tag: "None" })
  assert.deepEqual(timeline.tracks.map((t) => [t.label, t.kind, t.pinned]), [
    ["Extreme candy", "video", false],
    ["Heidi", "video", false],
    ["Voice", "voice", true],
    ["Music", "music", true],
    ["Captions", "captions", true]
  ])
  const candy = lane(timeline, "video:candy")
  const heidi = lane(timeline, "video:heidi")
  // every shot lands in its own video's lane (shot 3 is Heidi's)
  const shotsIn = (t: typeof candy) => [...new Set(t.clips.flatMap((c) => c.target._tag === "Shot" ? [c.target.k] : []))]
  assert.deepEqual(shotsIn(candy), [0, 1, 3])
  assert.deepEqual(shotsIn(heidi), [2])
  // real lines in their video's lane, pointing at their script beat, with their frames
  const realsIn = (t: typeof candy) => t.clips.filter((c) => c.target._tag === "Real").map((c) => [c.label, c.target, c.frame])
  assert.deepEqual(realsIn(heidi), [["“It's my left hand.”", { _tag: "Real", beat: 1 }, "insert-0.jpg"]])
  assert.deepEqual(realsIn(candy), [["“This is so nasty.”", { _tag: "Real", beat: 3 }, "outro-0.jpg"]])
  // Heidi's real line plays after "taste." (2.4s) for 2s
  const real = heidi.clips.find((c) => c.target._tag === "Real")!
  assert.deepEqual([real.start, real.end], [2.4, 4.4])
  // the voice lane: each narration line with its stretch of the voiceover's waveform
  const voice = lane(timeline, "voice")
  assert.deepEqual(voice.clips.map((c) => [c.target, c.wave]), [
    [{ _tag: "Narration", beat: 0 }, { url: "vo.wav", from: 0, to: 2.4 }],
    [{ _tag: "Narration", beat: 2 }, { url: "vo.wav", from: 2.5, to: 4.4 }]
  ])
  assert.equal(lane(timeline, "music").note, "No music · voice only")
  assert.equal(timeline.total, layout.total)
})

test("the music lane shows the parts and the drop", () => {
  const timeline = narrated({
    _tag: "Bed",
    url: "bed.wav",
    song: "Viral drop song",
    parts: [{ index: 0, start: 0, end: 2.4, label: "Groove" }, { index: 1, start: 2.4, end: 9, label: "Drop" }],
    drop: { at: 2.4, word: "Heidi" }
  })
  const music = lane(timeline, "music")
  assert.deepEqual(music.clips.map((c) => [c.label, c.start, c.end, c.target]), [
    ["Groove · Viral drop song", 0, 2.4, { _tag: "Music", index: 0 }],
    ["Drop", 2.4, layout.total, { _tag: "Music", index: 1 }]
  ])
  assert.deepEqual(music.marks, [{ at: 2.4, label: "drop · “Heidi”" }])
  assert.equal(narrated({ _tag: "NotFitted" }).tracks.find((t) => t.id === "music")!.note, "The song is fitted when the short is laid out")
})

test("a narrated short before its voiceover has no lanes yet", () => {
  const timeline = tracksFor({
    format: "narrated", videos: candyHeidi, captions: null, layout: null, beats: [], shots: null, realFrame: () => null, voiceUrl: null, music: { _tag: "None" }
  })
  assert.equal(timeline.tracks.length, 0)
  assert.match(timeline.empty ?? "", /voiceover/)
})

const section = (key: string, source: number, start: number, end: number, beat: EditSection["beat"]): EditSection =>
  ({ key, source, start, end, beat, text: "", frame: null, reason: "" }) as unknown as EditSection

test("a cut-down short: each video's sections in its lane, the sound per section, captions from the words, no music", () => {
  const sections = [section("a", 0, 10, 14, "hook"), section("b", 1, 100, 103, "rising_action"), section("c", 0, 50, 55, "payoff")]
  const wordsOf = (v: number) => v === 0
    ? [{ w: "Watch", s: 10.1, e: 10.4 }, { w: "this.", s: 10.5, e: 11 }, { w: "Done!", s: 50.2, e: 50.6 }]
    : [{ w: "Then", s: 100.2, e: 100.5 }]
  const captions = sectionCues(sections, wordsOf, { mode: "chunk", maxWords: 3, case: "as-spoken" })
  const timeline = tracksFor({ format: "cut-down", videos: candyHeidi, captions: { cues: captions, from: "words" }, sections, stillOf: (k) => `still-${k}.jpg` })
  assert.deepEqual(timeline.tracks.map((t) => t.label), ["Extreme candy", "Heidi", "Sound", "Captions", "Music"])
  assert.deepEqual(lane(timeline, "video:candy").clips.map((c) => [c.label, c.start, c.end, c.frame]), [["Hook", 0, 4, "still-0.jpg"], ["Payoff", 7, 12, "still-2.jpg"]])
  assert.deepEqual(lane(timeline, "video:heidi").clips.map((c) => [c.start, c.end, c.target]), [[4, 7, { _tag: "Section", k: 1 }]])
  assert.deepEqual(lane(timeline, "sound").clips.map((c) => c.color), ["blue", "orange", "blue"])
  // each section's words at their place in the short, grouped across sections as the renderer does
  assert.deepEqual(captions.map((c) => [c.text, Number(c.start.toFixed(2))]), [["Watch this.", 0.1], ["Then Done!", 4.2]])
  assert.match(lane(timeline, "music").note ?? "", /No music/)
  assert.equal(timeline.total, 12)
})

const entry = (rank: number, source: number, label: string, base: number) => ({
  rank,
  ...(source === 0 ? {} : { source }),
  label,
  emoji: "🐾",
  shots: (["before", "care", "after"] as const).map((role, k) => ({ role, start: base + k * 10, end: base + k * 10 + 2, framing: "window" as const, note: role }))
})

test("a ranking: entries in play order with #1 last, each video's moments in its lane, the sound per entry, no music", () => {
  const rescue = [video("kai", "Kai", "pink"), video("feral", "Feral cat", "violet"), video("helen", "Helen", "orange")]
  const ranking: RankingDraft = {
    title: { lead: "Top 3", accent: "rescues" },
    order: [3, 2, 1],
    entries: [entry(1, 0, "Kai loses 100 pounds", 100), entry(2, 1, "Hissing cat melts", 0), entry(3, 2, "Blind cow", 40)]
  }
  const wordsOf = (v: number) => v === 2 ? [{ w: "She", s: 40.5, e: 40.8 }, { w: "sees.", s: 41, e: 41.4 }] : []
  const captions = rankingCues(ranking, wordsOf, { mode: "chunk", maxWords: 3, case: "upper" })
  const timeline = tracksFor({ format: "ranking", videos: rescue, captions: { cues: captions, from: "words" }, ranking, stillOf: (rank, k) => `${rank}-${k}.jpg` })
  assert.deepEqual(timeline.tracks.map((t) => t.label), ["Entries", "Kai", "Feral cat", "Helen", "Sound", "Captions", "Music"])
  const entries = lane(timeline, "entries")
  assert.deepEqual(entries.clips.map((c) => [c.label, c.start, c.end]), [["#3 Blind cow 🐾", 0, 6], ["#2 Hissing cat melts 🐾", 6, 12], ["#1 Kai loses 100 pounds 🐾", 12, 18]])
  // Kai (#1) plays last: its before, care and after in its own lane
  assert.deepEqual(lane(timeline, "video:kai").clips.map((c) => [c.label, c.start, c.end, c.frame]), [
    ["Before", 12, 14, "1-0.jpg"],
    ["Care", 14, 16, "1-1.jpg"],
    ["After", 16, 18, "1-2.jpg"]
  ])
  assert.deepEqual(lane(timeline, "video:helen").clips.map((c) => c.target), [0, 1, 2].map((shot) => ({ _tag: "Entry", rank: 3, shot })))
  assert.deepEqual(lane(timeline, "sound").clips.map((c) => c.color), ["orange", "violet", "pink"])
  assert.deepEqual(captions.map((c) => [c.text, c.start]), [["SHE SEES.", 0.5]])
  assert.equal(lane(timeline, "music").note, "No music · rankings play each clip's own sound")
  assert.ok(lane(timeline, "music").clips.length === 0)
})

test("picking, the ruler and hidden lanes", () => {
  const timeline = narrated({ _tag: "None" })
  const candy = lane(timeline, "video:candy")
  assert.equal(clipAt(candy, 0.1)?.target._tag, "Shot")
  assert.ok(sameTarget({ _tag: "Entry", rank: 2, shot: 0 }, { _tag: "Entry", rank: 2, shot: null }), "an entry is selected with any of its shots")
  assert.ok(!sameTarget({ _tag: "Shot", k: 1 }, { _tag: "Section", k: 1 }))
  assert.equal(rulerStep(46), 5)
  assert.equal(rulerStep(131), 15)
  assert.deepEqual(visibleTracks(timeline.tracks, new Set(["captions", "video:heidi"])).map((t) => t.id), ["video:candy", "voice", "music"])
})

test("the end card: after the outro on the first video's lane, its closing line on the voice's; a cut-down's card alone", () => {
  const take = [...words, ...["Which", "hand?", "Tell"].map((w, i) => ({ w, s: 4.7 + i * 0.4, e: 5 + i * 0.4 }))]
  const closing: Script = { ...script, beats: [...script.beats, { _tag: "Cta", question: "Which hand?" }] }
  const withCard = layoutTimeline(closing, take, 6, { endCard: true })
  const timeline = tracksFor({
    format: "narrated",
    videos: candyHeidi,
    captions: null,
    layout: withCard,
    beats: closing.beats,
    shots: null,
    realFrame: () => null,
    voiceUrl: "vo.wav",
    music: { _tag: "None" }
  })
  const card = lane(timeline, "video:candy").clips.find((c) => c.id === "end-card")!
  assert.deepEqual([card.start, card.end, card.target], [withCard.closing!.start, withCard.total, { _tag: "Narration", beat: 4 }])
  assert.equal(lane(timeline, "video:heidi").clips.some((c) => c.id === "end-card"), false)
  const line = lane(timeline, "voice").clips.at(-1)!
  assert.equal(line.label, "Which hand?")
  assert.equal(line.start, card.start + 0.35)
  assert.deepEqual(line.wave, { url: "vo.wav", from: withCard.closing!.from, to: withCard.closing!.to })

  const sections = [section("a", 0, 10, 14, "hook"), section("c", 0, 50, 55, "payoff")]
  const cut = tracksFor({ format: "cut-down", videos: candyHeidi, captions: null, sections, stillOf: () => null, endCard: "Would you?" })
  assert.equal(cut.total, 9 + 3)
  assert.deepEqual(lane(cut, "video:candy").clips.at(-1)!.label, "End card")
})

// A narrated ranking of two: "Two dogs. Number two, Rex. Number one, Max." with a real line in each entry
test("a narrated ranking: an Entries lane from each \"Number\" to the next, and the #N cards on the voice lane", () => {
  const rankWords = ["Two", "dogs.", "Number", "two,", "Rex.", "Number", "one,", "Max."].map((w, i) => ({ w, s: i * 0.5, e: i * 0.5 + 0.4 }))
  const ranked: Script = {
    headline: null,
    beats: [
      { _tag: "Narration", text: "Two dogs." },
      { _tag: "Narration", text: "Number two, Rex." },
      { _tag: "Real", quote: "Good boy.", start: 10, end: 11 },
      { _tag: "Narration", text: "Number one, Max." },
      { _tag: "Real", quote: "Best dog.", start: 20, end: 22, source: 1 }
    ]
  }
  const rankLayout = layoutTimeline(ranked, rankWords, 4)
  const entries = countdownOf(ranked, 2)!.entries.map((e) => ({ rank: e.rank, beat: e.start, source: e.source }))
  const timeline = tracksFor({
    format: "narrated", videos: candyHeidi, captions: null, layout: rankLayout, beats: ranked.beats, shots: null,
    realFrame: () => null, countdown: entries, voiceUrl: null, music: { _tag: "None" }
  })
  const lanes = lane(timeline, "entries")
  assert.equal(timeline.tracks[0]!.id, "entries", "the Entries lane on top")
  assert.deepEqual(lanes.clips.map((c) => [c.label, c.start, c.end, c.target]), [
    ["#2 · Extreme candy", 1, 3.5, { _tag: "Narration", beat: 1 }],
    ["#1 · Heidi", 3.5, timeline.total, { _tag: "Narration", beat: 3 }]
  ])
  assert.deepEqual(lane(timeline, "voice").marks, [{ at: 1, label: "#2" }, { at: 3.5, label: "#1" }])
  // not a ranking: no lane, no marks
  assert.equal(narrated({ _tag: "None" }).tracks.some((t) => t.id === "entries"), false)
})
