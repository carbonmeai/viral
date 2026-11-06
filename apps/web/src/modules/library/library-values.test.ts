import type { MusicTrack, Preset, Project } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { buildStart, copyName, fileName, musicStep, pathKind, previewLayout, sampleCaption, shortsByStyle, shortsByTrack, stylesByVoice, trackLength } from "./library-values.ts"

// Only the fields these helpers read; the rest of each record doesn't matter here.
const recap = { id: "p1", name: "Viral recap", isDefault: true, config: { voice: { voiceId: "adam" } } } as unknown as Preset
const bold = { id: "p2", name: "Headline full-bleed", isDefault: false, config: { voice: { voiceId: "george" } } } as unknown as Preset
const project = (id: string, presetId: string | null, musicTrackId: string | null) => ({ id, presetId, musicTrackId }) as unknown as Project

test("a short without a style counts under the default one", () => {
  const byStyle = shortsByStyle([recap, bold], [project("a", null, null), project("b", "p2", null), project("c", "p1", null)])
  assert.deepEqual(byStyle.get("p1")?.map((p) => p.id), ["a", "c"])
  assert.deepEqual(byStyle.get("p2")?.map((p) => p.id), ["b"])
})

test("tracks and voices list who uses them", () => {
  const track = { id: "t1" } as unknown as MusicTrack
  assert.deepEqual(shortsByTrack([track], [project("a", null, "t1"), project("b", null, null)]).get("t1")?.map((p) => p.id), ["a"])
  assert.deepEqual(stylesByVoice([recap, bold], "adam").map((p) => p.name), ["Viral recap"])
})

test("copies get a name that isn't taken", () => {
  assert.equal(copyName("Viral recap", ["Viral recap"]), "Viral recap copy")
  assert.equal(copyName("Viral recap", ["Viral recap copy", "Viral recap copy 2"]), "Viral recap copy 3")
})

test("the build-up starts 8 bars before the drop", () => {
  // 120 bpm: a bar is 2s, 8 bars are 16s
  assert.equal(buildStart({ bpm: 120, dropS: 20 }), 4)
  assert.equal(buildStart({ bpm: 120, dropS: 10 }), 0, "never before the start")
  assert.equal(buildStart({ bpm: null, dropS: 10 }), null)
})

test("caption previews follow the style's words and case", () => {
  const base = { mode: "chunk", maxWords: 3, case: "upper" } as const
  assert.deepEqual(sampleCaption({ captions: base } as never), { words: ["THIS", "CANDY", "HITS"], highlight: 2 })
  assert.deepEqual(sampleCaption({ captions: { ...base, mode: "word", case: "lower" } } as never).words, ["this"])
  assert.deepEqual(sampleCaption({ captions: { ...base, maxWords: 2, case: "as-spoken" } } as never).words, ["This", "Candy"])
})

test("the preview's geometry comes from the style's canvas", () => {
  const config = { canvas: [1080, 1920], framing: "band", mainHeight: 1216, headline: { y: 0.035, size: 0.13 }, captions: { y: 0.74 } } as never
  const layout = previewLayout(config)
  assert.equal(layout.band, 1216 / 1920)
  assert.equal(layout.headlineSize, (0.13 * 1080) / 1920)
  assert.equal(previewLayout({ ...(config as object), framing: "full", headline: null } as never).band, 1)
  assert.equal(trackLength(136.4), "2:16")
  assert.equal(trackLength(null), "—")
})

test("refused saves read as plain problems", async () => {
  const { refusal } = await import("./library-values.ts")
  assert.deepEqual(refusal({ _tag: "PresetInvalid", problems: ["the loudness must be -30–-6"] }), ["the loudness must be -30–-6"])
  assert.match(refusal({ _tag: "PresetNameTaken", presetName: "Bold" })[0]!, /already a style called “Bold”/)
  assert.match(refusal(null)[0]!, /didn’t save/)
})

test("a used-by link opens the Music step only when the editor has one", () => {
  assert.equal(musicStep(["script", "voice", "render"]), undefined)
  assert.equal(musicStep(["script", "music", "render"] as unknown as ReadonlyArray<"script">), "music")
})

test("a typed path is a song when it names an audio file, else a folder", () => {
  assert.equal(pathKind("/Music/drop.MP3"), "file")
  assert.equal(pathKind(" /Music/songs/ "), "folder")
  assert.equal(fileName("/Music/songs/drop.mp3"), "drop.mp3")
  assert.equal(fileName("/Music/songs/"), "songs")
})
