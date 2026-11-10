// The narrated renderer's opt-in joins (the skill's 10 Nov render_narrated.py): `resume_word` skips narration a clip
// says anyway, `insert_pad` lets the narrator breathe before a clip, `soft_joins` fades every join. A red video with an
// 800 Hz tone and a 500 Hz voiceover, so the output can be checked by colour, pitch and level.
import type { NarratedPlan } from "@viral/contracts"
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
before(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "viral-joins-")))
  process.env.VIRAL_HOME = join(work, "home")
  ffmpeg("-f", "lavfi", "-i", "color=c=red:s=320x180:d=12:r=25", "-f", "lavfi", "-i", "sine=f=800:d=12", "-shortest",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", join(work, "v1.mp4"))
  ffmpeg("-f", "lavfi", "-i", "sine=f=500:d=3", join(work, "vo.wav"))
  // six voiceover words, half a second apart: One 0–0.4 · two 0.5–0.9 · three 1.0–1.4 · four 1.5–1.9 · five 2.0–2.4 · six
  const words = ["One", "two", "three", "four", "five", "six"].map((w, i) => ({ w, s: i * 0.5, e: i * 0.5 + 0.4 }))
  writeFileSync(join(work, "vo.json"), JSON.stringify({ source: "vo.wav", language: "en", segments: [{ start: 0, end: 2.9, text: "x", words }] }))
  const said = (w: string, s: number) => ({ w, s, e: s + 0.4 })
  writeFileSync(join(work, "v1.json"), JSON.stringify({
    source: "v1.mp4",
    language: "en",
    segments: [{ start: 5, end: 6, text: "Pure acid.", words: [said("Pure", 5), said("acid.", 5.5)] }]
  }))
})
after(() => rmSync(work, { recursive: true, force: true }))

// one insert after "two" (a 1 s clip of V1, 800 Hz), and the narration on to "six"
const plan = (overrides: Partial<NarratedPlan>, insert: Partial<NonNullable<NarratedPlan["inserts"]>[number]> = {}): NarratedPlan => ({
  slug: "joins",
  source: join(work, "v1.mp4"),
  source_transcript: join(work, "v1.json"),
  voiceover: join(work, "vo.wav"),
  voiceover_transcript: join(work, "vo.json"),
  canvas: [360, 640],
  framing: "full",
  captions: false,
  shots: [
    { src: 1, word: 0, word_text: "One" },
    { src: 3, word: 2, word_text: "three" },
    { src: 8, word: 4, word_text: "five" }
  ],
  inserts: [{ start: 5, end: 6, after_word: 1, after_word_text: "two", note: "Pure acid.", ...insert }],
  lufs: -14,
  ...overrides
})

const render = (p: NarratedPlan, name: string) =>
  Effect.runPromiseExit(Effect.gen(function*() {
    mkdirSync(join(work, name), { recursive: true })
    const engine = yield* RenderEngine
    return yield* engine.renderNarrated(p, join(work, name), join(work, name, `${name}.mp4`), () => Effect.void)
  }).pipe(Effect.provide(RenderEngine.layer)))

const ok = async (p: NarratedPlan, name: string) => {
  const exit = await render(p, name)
  assert.ok(Exit.isSuccess(exit), Exit.isFailure(exit) ? String(exit.cause) : "")
  return exit.value
}

const samples = (file: string, t: number, seconds: number) => {
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", String(t), "-t", String(seconds), "-i", file, "-vn", "-ac", "1", "-ar", "48000",
    "-f", "s16le", "-"])
  return Array.from({ length: Math.floor(raw.length / 2) }, (_, i) => raw.readInt16LE(i * 2))
}
// the pitch over a stretch, from its zero crossings
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
const srtWords = (mp4: string) =>
  readFileSync(mp4.replace(/\.mp4$/, ".srt"), "utf8").split("\n\n").map((cue) => cue.trim().split("\n")[2]).filter((w) => w !== undefined)

test("resume_word skips the narration the clip says anyway, and everything after it moves up", { timeout: 120_000 }, async () => {
  // the narration pauses after "two" (0.9 s), the clip plays 1 s, and picks up at "five" (2.0 − 0.08 s): three and four
  // are never heard
  const out = await ok(plan({}, { resume_word: 4, resume_word_text: "five" }), "resume")
  const expected = 0.9 + 1 + (3 - 1.92)
  assert.ok(Math.abs(out.durationS - expected) < 0.1, `duration ${out.durationS}, expected ${expected}`)
  assert.ok(Math.abs(pitch(out.output, 1.1, 0.6) - 800) < 40, "the clip plays after two")
  assert.ok(Math.abs(pitch(out.output, 2.1, 0.6) - 500) < 40, "then the narration again")
  assert.deepEqual(srtWords(out.output), ["One", "two", "Pure", "acid.", "five", "six"], "three and four are skipped")
})

test("a resume word that no longer matches the voiceover fails", async () => {
  const exit = await render(plan({}, { resume_word: 4, resume_word_text: "four" }), "mismatch")
  assert.ok(Exit.isFailure(exit))
  assert.match(String(exit.cause), /resume word 4 is 'five', plan expects 'four'/)
})

test("insert_pad lets the narrator breathe before the clip: half way to the next word at most", { timeout: 120_000 }, async () => {
  // the pause moves from 0.9 to min(0.9 + 0.25, half way to "three" at 1.0) = 0.95
  const out = await ok(plan({ insert_pad: 0.25 }), "pad")
  assert.ok(Math.abs(out.durationS - 4) < 0.1, `duration ${out.durationS}`)
  assert.ok(Math.abs(pitch(out.output, 1.2, 0.6) - 800) < 40, "the clip, 0.95–1.95 s")
  assert.ok(Math.abs(pitch(out.output, 2.2, 0.6) - 500) < 40, "the narration from 0.95 s on")
})

test("soft joins fade the clip in and out; without them it starts at full level", { timeout: 120_000 }, async () => {
  const hardRender = await ok(plan({}), "hard")
  const softRender = await ok(plan({ soft_joins: true }), "soft")
  const [hard, soft] = [hardRender.output, softRender.output]
  // the clip plays 0.9–1.9 s in both; compare its first 25 ms with its middle
  const rise = (file: string) => rms(file, 0.905, 0.025) / rms(file, 1.3, 0.1)
  assert.ok(rise(hard) > 0.6, `hard cut starts loud (${rise(hard).toFixed(2)})`)
  assert.ok(rise(soft) < 0.5, `soft join fades in (${rise(soft).toFixed(2)})`)
  const fall = (file: string) => rms(file, 1.87, 0.025) / rms(file, 1.3, 0.1)
  assert.ok(fall(soft) < 0.5, `and fades out (${fall(soft).toFixed(2)})`)
  assert.ok(Math.abs(softRender.durationS - hardRender.durationS) < 0.05, "the same length")
})
