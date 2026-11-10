// The end card (a style's comment question, end_card.py): a narrated short's closing line is cut out of the narration
// and plays under the card; a cut-down short holds the card alone. Tiny generated media: a red video with an 800 Hz tone,
// and a voiceover at 500 Hz for the story and 300 Hz for the closing line, so the output can be checked by colour and
// pitch.
import type { CutRenderPlan, NarratedPlan } from "@viral/contracts"
import { Effect, Exit } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { RenderEngine } from "./render-engine.ts"

let work: string
const ffmpeg = (...args: Array<string>) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args])
const said = (w: string, s: number) => ({ w, s, e: s + 0.4 })
const transcript = (words: ReadonlyArray<{ w: string; s: number; e: number }>) =>
  JSON.stringify({ source: "x", language: "en", segments: [{ start: words[0]!.s, end: words.at(-1)!.e, text: "x", words }] })
before(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "viral-end-card-")))
  process.env.VIRAL_HOME = join(work, "home")
  ffmpeg("-f", "lavfi", "-i", "color=c=red:s=320x180:d=12:r=25", "-f", "lavfi", "-i", "sine=f=800:d=12", "-shortest",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", join(work, "v1.mp4"))
  // the take: the story at 500 Hz (0–2.5 s), then the closing line at 300 Hz (2.5–4 s)
  ffmpeg("-f", "lavfi", "-i", "sine=f=500:d=2.5", "-f", "lavfi", "-i", "sine=f=300:d=1.5", "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1",
    join(work, "vo.wav"))
  writeFileSync(join(work, "vo.json"), transcript([
    ...["One", "two", "three", "four", "five"].map((w, i) => said(w, i * 0.5)),
    said("Which", 2.6),
    said("one?", 3.1),
    { w: "Subscribe.", s: 3.55, e: 3.9 }
  ]))
  writeFileSync(join(work, "v1.json"), transcript([said("Pure", 5), said("acid.", 5.5), said("Red", 8), said("again.", 8.5)]))
})
after(() => rmSync(work, { recursive: true, force: true }))

const narrated = (overrides: Partial<NarratedPlan> = {}): NarratedPlan => ({
  slug: "end-card",
  source: join(work, "v1.mp4"),
  source_transcript: join(work, "v1.json"),
  voiceover: join(work, "vo.wav"),
  voiceover_transcript: join(work, "vo.json"),
  canvas: [360, 640],
  framing: "full",
  captions: false,
  shots: [{ src: 1, word: 0, word_text: "One" }, { src: 3, word: 2, word_text: "three" }],
  // the payoff: a second of V1 (800 Hz) after the narration
  outro: [{ start: 5, end: 6, note: "Pure acid." }],
  narration_end: 2.48,
  cta: { question: "Which one would you eat?", vo_start: 2.48, vo_end: 4 },
  lufs: -14,
  ...overrides
})

const samples = (file: string, t: number, seconds: number) => {
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", String(t), "-t", String(seconds), "-i", file, "-vn", "-ac", "1", "-ar", "48000",
    "-f", "s16le", "-"])
  return Array.from({ length: Math.floor(raw.length / 2) }, (_, i) => raw.readInt16LE(i * 2))
}
const pitch = (file: string, t: number, seconds: number) => {
  const s = samples(file, t, seconds)
  let crossings = 0
  for (let i = 1; i < s.length; i++) if ((s[i - 1]! < 0) !== (s[i]! < 0)) crossings++
  return crossings / 2 / seconds
}
const rms = (file: string, t: number, seconds: number) => {
  const s = samples(file, t, seconds)
  return Math.sqrt(s.reduce((n, x) => n + x * x, 0) / Math.max(1, s.length))
}
// a frame's pixels as RGB, and how much of a band of rows (fractions of the height) is a colour
const frame = (file: string, t: number) => {
  const [w, h] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file])
    .toString().trim().split(",").map(Number) as [number, number]
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 * 1024 * 1024 })
  return { w, h, at: (x: number, y: number) => [raw[(y * w + x) * 3]!, raw[(y * w + x) * 3 + 1]!, raw[(y * w + x) * 3 + 2]!] as const }
}
const share = (file: string, t: number, rows: readonly [number, number], is: (rgb: readonly [number, number, number]) => boolean) => {
  const f = frame(file, t)
  let n = 0, hit = 0
  for (let y = Math.floor(rows[0] * f.h); y < Math.floor(rows[1] * f.h); y++) {
    for (let x = 0; x < f.w; x++, n++) if (is(f.at(x, y))) hit++
  }
  return hit / n
}
const yellow = ([r, g, b]: readonly [number, number, number]) => r > 200 && g > 170 && b < 90
const white = ([r, g, b]: readonly [number, number, number]) => r > 220 && g > 220 && b > 220
const srtWords = (mp4: string) =>
  readFileSync(mp4.replace(/\.mp4$/, ".srt"), "utf8").split("\n\n").map((cue) => cue.trim().split("\n")[2]).filter((w) => w !== undefined)

test("a narrated short ends on the card: the closing line is cut out of the narration and plays under it", { timeout: 180_000 }, async () => {
  const exit = await Effect.runPromiseExit(Effect.gen(function*() {
    mkdirSync(join(work, "narrated"), { recursive: true })
    return yield* (yield* RenderEngine).renderNarrated(narrated(), join(work, "narrated"), join(work, "narrated", "end-card.mp4"), () => Effect.void)
  }).pipe(Effect.provide(RenderEngine.layer)))
  assert.ok(Exit.isSuccess(exit), Exit.isFailure(exit) ? String(exit.cause) : "")
  const out = exit.value.output
  // the story: 2.48 s of narration + the 1 s payoff; the card: 0.35 s lead + the 1.52 s closing line + 0.6 s of air
  const story = 2.48 + 1
  const card = 0.35 + 1.52 + 0.6
  assert.ok(Math.abs(exit.value.durationS - (story + card)) < 0.1, `duration ${exit.value.durationS}, expected ${story + card}`)
  assert.ok(Math.abs(pitch(out, 1.4, 0.8) - 500) < 40, "the narration")
  assert.ok(Math.abs(pitch(out, 2.55, 0.4) - 800) < 40, "the payoff right after it: no closing line before it")
  assert.ok(Math.abs(pitch(out, story + 0.5, 1.2) - 300) < 40, "the closing line under the card")
  // the card: nothing yellow before it; then the yellow question near the top and the white SUBSCRIBE on the red pill
  assert.equal(share(out, 3.0, [0.1, 0.3], yellow), 0, "no question during the payoff")
  const end = story + card - 0.2
  assert.ok(share(out, end, [0.1, 0.3], yellow) > 0.01, "the question in yellow at the top")
  assert.ok(share(out, end, [0.81, 0.88], white) > 0.01, "SUBSCRIBE in white on the pill")
  const [r, g, b] = frame(out, end).at(180, 320)
  assert.ok(r > 150 && g < 80 && b < 80, `the held frame of the payoff behind it (${r},${g},${b})`)
  assert.deepEqual(srtWords(out).slice(-3), ["Which", "one?", "Subscribe."], "the closing line in the srt")
})

test("a cut-down short holds the card alone, silent, after its last section", { timeout: 180_000 }, async () => {
  const plan: CutRenderPlan = {
    slug: "cut-end-card",
    source: join(work, "v1.mp4"),
    transcript: join(work, "v1.json"),
    framing: "crop",
    captions: false,
    snap: false,
    sections: [{ beat: "hook", start: 5, end: 6.2 }, { beat: "payoff", start: 8, end: 9.2 }],
    cta: { question: "Would you have quit?", seconds: 2 },
    lufs: -14
  }
  const exit = await Effect.runPromiseExit(Effect.gen(function*() {
    return yield* (yield* RenderEngine).renderCut(plan, work, join(work, "cut", "cut-end-card.mp4"), () => Effect.void)
  }).pipe(Effect.provide(RenderEngine.layer)))
  assert.ok(Exit.isSuccess(exit), Exit.isFailure(exit) ? String(exit.cause) : "")
  const out = exit.value.output
  assert.ok(Math.abs(exit.value.durationS - 4.4) < 0.1, `duration ${exit.value.durationS}`)
  assert.ok(Math.abs(pitch(out, 0.3, 0.6) - 800) < 40, "the creator's own audio first")
  assert.ok(rms(out, 3.2, 0.8) < 0.05 * rms(out, 0.3, 0.6), "the card is silent")
  assert.ok(share(out, 4.1, [0.1, 0.3], yellow) > 0.01, "the question in yellow")
  assert.ok(share(out, 4.1, [0.81, 0.88], white) > 0.01, "the SUBSCRIBE pill")
})
