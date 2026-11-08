// The cut-down renderer over two videos: tiny generated clips (a red video with a 300 Hz tone, a blue one of another
// size, frame rate and sample rate with an 800 Hz tone), so the output can be checked by colour and pitch.
import type { CutRenderPlan } from "@viral/contracts"
import { Effect, Exit, Schema } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { RenderEngine, RenderError } from "./render-engine.ts"

let work: string
const ffmpeg = (...args: Array<string>) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args])
const said = (w: string, s: number) => ({ w, s, e: s + 0.4 })
const transcript = (words: ReadonlyArray<{ w: string; s: number; e: number }>) =>
  JSON.stringify({ source: "x", language: "en", segments: [{ start: words[0]!.s, end: words.at(-1)!.e, text: "x", words }] })
before(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "viral-cut-videos-")))
  process.env.VIRAL_HOME = join(work, "home")
  ffmpeg("-f", "lavfi", "-i", "color=c=red:s=320x180:d=12:r=25", "-f", "lavfi", "-i", "sine=f=300:d=12", "-shortest",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", join(work, "v1.mp4"))
  ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=240x240:d=12:r=30", "-f", "lavfi", "-i", "sine=f=800:d=12:sample_rate=44100", "-shortest",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", join(work, "v2.mp4"))
  writeFileSync(join(work, "v1.json"), transcript([said("Red", 2), said("talks.", 2.5), said("Red", 8), said("again.", 8.5)]))
  writeFileSync(join(work, "v2.json"), transcript([said("Blue", 5), said("answers.", 5.5)]))
})
after(() => rmSync(work, { recursive: true, force: true }))

// red V1, then V2 (blue), then V1 again: 0–2 red · 2–4 blue · 4–5 red
const plan = (overrides: Partial<CutRenderPlan> = {}): CutRenderPlan => ({
  slug: "two-videos-cut",
  source: join(work, "v1.mp4"),
  transcript: join(work, "v1.json"),
  sources: [{ path: join(work, "v2.mp4"), transcript: join(work, "v2.json") }],
  framing: "crop",
  captions: false,
  // V1's range covers the V2 section's seconds, which must not count against it
  exclude: [[5, 6]],
  exclude_by_source: { "1": [[0, 1]] },
  snap: false,
  sections: [
    { beat: "hook", start: 2, end: 4 },
    { beat: "rising_action", start: 4.5, end: 6.5, source: 1 },
    { beat: "payoff", start: 8, end: 9 }
  ],
  lufs: -14,
  ...overrides
})

const render = (p: CutRenderPlan) =>
  Effect.runPromiseExit(Effect.gen(function*() {
    const engine = yield* RenderEngine
    return yield* engine.renderCut(p, work, join(work, "out", "two-videos-cut.mp4"), () => Effect.void)
  }).pipe(Effect.provide(RenderEngine.layer)))

const renderError = async (p: CutRenderPlan) => {
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

test("plays each section from its own video, with its own sound and words", { timeout: 120_000 }, async () => {
  const exit = await render(plan({ captions: true }))
  assert.ok(Exit.isSuccess(exit), Exit.isFailure(exit) ? String(exit.cause) : "")
  const out = exit.value.output
  assert.equal(exit.value.sections, 3)
  assert.ok(Math.abs(exit.value.durationS - 5) < 0.1, `duration ${exit.value.durationS}`)
  // the captions sit low (0.70 of the height), so the centre stays the footage's colour
  const colours = [1, 3, 4.5].map((t) => pixel(out, t))
  assert.ok(isRed(colours[0]!), `1s is V1 ${JSON.stringify(colours[0])}`)
  assert.ok(isBlue(colours[1]!), `3s is V2 ${JSON.stringify(colours[1])}`)
  assert.ok(isRed(colours[2]!), `4.5s is V1 again ${JSON.stringify(colours[2])}`)
  assert.ok(Math.abs(pitch(out, 0.4, 1.2) - 300) < 40, "V1's sound")
  assert.ok(Math.abs(pitch(out, 2.4, 1.2) - 800) < 40, "V2's sound")
  assert.ok(Math.abs(pitch(out, 4.2, 0.6) - 300) < 40, "V1's sound again")
  // the captions are each section's own words, at their places in the short
  const srt = readFileSync(exit.value.captions, "utf8")
  assert.match(srt, /Red talks\./)
  assert.match(srt, /00:00:02,500 --> .*\nBlue answers\./)
  assert.match(srt, /Red again\./)
})

test("a V2 section inside V2's excluded range fails, naming the video", async () => {
  const error = await renderError(plan({ exclude_by_source: { "1": [[6, 7]] } }))
  assert.equal(error.code, "excluded-range")
  assert.match(error.message, /video 2 section 4\.5–6\.5s/)
})

test("a section from a video the plan doesn't have fails", async () => {
  const error = await renderError(plan({ sources: [] }))
  assert.equal(error.code, "unknown-source")
})
