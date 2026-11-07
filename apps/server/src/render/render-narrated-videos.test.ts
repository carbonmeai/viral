// The narrated renderer over two videos: tiny generated clips (a red video with a 300 Hz tone, a blue one of
// another size with an 800 Hz tone) and a 500 Hz voiceover, so the output can be checked by colour and pitch.
import type { NarratedPlan } from "@viral/contracts"
import { Effect, Exit, Schema } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { RenderEngine, RenderError } from "./render-engine.ts"

let work: string
const ffmpeg = (...args: Array<string>) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args])
before(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "viral-two-videos-")))
  process.env.VIRAL_HOME = join(work, "home")
  ffmpeg("-f", "lavfi", "-i", "color=c=red:s=320x180:d=12:r=25", "-f", "lavfi", "-i", "sine=f=300:d=12", "-shortest",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", join(work, "v1.mp4"))
  ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=240x240:d=12:r=30", "-f", "lavfi", "-i", "sine=f=800:d=12:sample_rate=44100", "-shortest",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", join(work, "v2.mp4"))
  ffmpeg("-f", "lavfi", "-i", "sine=f=500:d=3", join(work, "vo.wav"))
  // six voiceover words, half a second apart
  const words = ["One", "two", "three", "four", "five", "six"].map((w, i) => ({ w, s: i * 0.5, e: i * 0.5 + 0.4 }))
  writeFileSync(join(work, "vo.json"), JSON.stringify({ source: "vo.wav", language: "en", segments: [{ start: 0, end: 2.9, text: "x", words }] }))
  const said = (w: string, s: number) => ({ w, s, e: s + 0.4 })
  writeFileSync(join(work, "v2.json"), JSON.stringify({
    source: "v2.mp4",
    language: "en",
    segments: [{ start: 5, end: 6, text: "Pure acid.", words: [said("Pure", 5), said("acid.", 5.5)] }]
  }))
})
after(() => rmSync(work, { recursive: true, force: true }))

// red V1, then V2 (blue) under words 2–3 and as an insert after word 3, back to V1, and a V2 outro:
//   0–1.0 red · 1.0–1.9 blue · 1.9–2.9 blue insert (800 Hz) · 2.9–3.0 blue · 3.0–4.0 red · 4.0–5.0 blue outro
const plan = (overrides: Partial<NarratedPlan> = {}): NarratedPlan => ({
  slug: "two-videos",
  source: join(work, "v1.mp4"),
  sources: [{ path: join(work, "v2.mp4"), transcript: join(work, "v2.json") }],
  voiceover: join(work, "vo.wav"),
  voiceover_transcript: join(work, "vo.json"),
  canvas: [360, 640],
  framing: "full",
  captions: false,
  // V1's range covers the V2 shot's seconds, which must not count against it
  exclude: [[2.2, 2.6]],
  exclude_by_source: { "1": [[0, 0.5]] },
  shots: [
    { src: 1, word: 0, word_text: "One", note: "V1" },
    { src: 2, source: 1, word: 2, word_text: "three", note: "V2" },
    { src: 3, word: 4, word_text: "five", note: "V1 again" }
  ],
  inserts: [{ start: 5, end: 6, source: 1, after_word: 3, after_word_text: "four", note: "Pure acid." }],
  outro: [{ start: 7, end: 8, source: 1, note: "V2 outro" }],
  lufs: -14,
  ...overrides
})

const render = (p: NarratedPlan) =>
  Effect.runPromiseExit(Effect.gen(function*() {
    const engine = yield* RenderEngine
    return yield* engine.renderNarrated(p, work, join(work, "out", "two-videos.mp4"), () => Effect.void)
  }).pipe(Effect.provide(RenderEngine.layer)))

const renderError = async (p: NarratedPlan) => {
  const exit = await render(p)
  assert.ok(Exit.isFailure(exit))
  const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")
  assert.ok(error !== undefined && Schema.is(RenderError)(error.error), "fails with a RenderError")
  return error.error
}

// the centre pixel's colour at a time
const pixel = (file: string, t: number) => {
  const rgb = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "crop=8:8,scale=1:1",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
  return { r: rgb[0]!, g: rgb[1]!, b: rgb[2]! }
}
const isRed = ({ r, b }: { r: number; b: number }) => r > 150 && b < 90
const isBlue = ({ r, b }: { r: number; b: number }) => b > 150 && r < 90

// the audio's pitch over a stretch, from its zero crossings
const pitch = (file: string, t: number, seconds: number) => {
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", String(t), "-t", String(seconds), "-i", file, "-vn", "-ac", "1", "-ar", "48000",
    "-f", "s16le", "-"])
  let crossings = 0
  for (let i = 2; i + 1 < raw.length; i += 2) {
    if ((raw.readInt16LE(i - 2) < 0) !== (raw.readInt16LE(i) < 0)) crossings++
  }
  return crossings / 2 / seconds
}

test("plays each clip from its own video, with its own sound", { timeout: 120_000 }, async () => {
  const exit = await render(plan())
  assert.ok(Exit.isSuccess(exit), Exit.isFailure(exit) ? String(exit.cause) : "")
  const out = exit.value.output
  assert.ok(Math.abs(exit.value.durationS - 5) < 0.15, `duration ${exit.value.durationS}`)
  const colours = [0.5, 1.4, 2.4, 3.5, 4.5].map((t) => pixel(out, t))
  assert.ok(isRed(colours[0]!), `0.5s is V1 ${JSON.stringify(colours[0])}`)
  assert.ok(isBlue(colours[1]!), `1.4s is V2 ${JSON.stringify(colours[1])}`)
  assert.ok(isBlue(colours[2]!), `2.4s is the V2 insert ${JSON.stringify(colours[2])}`)
  assert.ok(isRed(colours[3]!), `3.5s is V1 ${JSON.stringify(colours[3])}`)
  assert.ok(isBlue(colours[4]!), `4.5s is the V2 outro ${JSON.stringify(colours[4])}`)
  // the narration is the voiceover's 500 Hz; the insert and outro play V2's own 800 Hz tone
  assert.ok(Math.abs(pitch(out, 0.2, 0.6) - 500) < 40, "the narration")
  assert.ok(Math.abs(pitch(out, 2.1, 0.6) - 800) < 40, "the V2 insert's sound")
  assert.ok(Math.abs(pitch(out, 4.2, 0.6) - 800) < 40, "the V2 outro's sound")
})

test("a V2 shot inside V2's excluded range fails, naming the video", async () => {
  const error = await renderError(plan({ exclude_by_source: { "1": [[1.5, 2.5]] } }))
  assert.equal(error.code, "excluded-range")
  assert.match(error.message, /video 2 source 2\.0/)
})

test("a clip from a video the plan doesn't have fails", async () => {
  const error = await renderError(plan({ sources: [] }))
  assert.equal(error.code, "unknown-source")
})
