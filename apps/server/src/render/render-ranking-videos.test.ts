// The ranking renderer over three tiny generated videos: a red landscape one with a 300 Hz tone, a (light enough not to count as black) blue upright one
// with an 800 Hz tone, and a green landscape one with no sound at all, so each entry can be checked by colour and
// pitch, and the list by the label that appears on its row.
import type { RankingRenderPlan } from "@viral/contracts"
import { Effect, Exit, Schema } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { RenderEngine, RenderError } from "./render-engine.ts"

let work: string
const W = 360
const H = 640
const ffmpeg = (...args: Array<string>) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args])
const said = (w: string, s: number) => ({ w, s, e: s + 0.4 })
const transcript = (words: ReadonlyArray<{ w: string; s: number; e: number }>) =>
  JSON.stringify({ source: "x", language: "en", segments: [{ start: words[0]!.s, end: words.at(-1)!.e, text: "x", words }] })
before(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "viral-ranking-videos-")))
  process.env.VIRAL_HOME = join(work, "home")
  ffmpeg("-f", "lavfi", "-i", "color=c=red:s=320x180:d=10:r=25", "-f", "lavfi", "-i", "sine=f=300:d=10", "-shortest",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", join(work, "red.mp4"))
  ffmpeg("-f", "lavfi", "-i", "color=c=0x2050FF:s=180x320:d=10:r=30", "-f", "lavfi", "-i", "sine=f=800:d=10:sample_rate=44100", "-shortest",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", join(work, "blue.mp4"))
  ffmpeg("-f", "lavfi", "-i", "color=c=green:s=320x180:d=10:r=25", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(work, "green.mp4"))
  writeFileSync(join(work, "red.json"), transcript([said("Red", 2.2), said("starts.", 2.7)]))
  writeFileSync(join(work, "blue.json"), transcript([said("Blue", 4.2), said("cares.", 4.7)]))
})
after(() => rmSync(work, { recursive: true, force: true }))

// plays #3 (red, 2 shots: 0–2 s and 2–3 s), then #2 (blue, 3–5 s), then #1 (green, 5–7.5 s)
const plan = (overrides: Partial<RankingRenderPlan> = {}): RankingRenderPlan => ({
  slug: "ranking-test",
  title: ["Ranking Test ", "Colours"],
  order: [3, 2, 1],
  videos: [
    { path: join(work, "red.mp4"), transcript: join(work, "red.json") },
    { path: join(work, "blue.mp4"), transcript: join(work, "blue.json") },
    { path: join(work, "green.mp4") }
  ],
  items: [
    { rank: 1, label: "Green", emoji: "🐸", shots: [{ source: 2, src: 1, dur: 2.5, framing: "window" }] },
    { rank: 2, label: "Blue", emoji: "🐳", shots: [{ source: 1, src: 4, dur: 2, framing: "fill" }] },
    {
      rank: 3,
      label: "Red",
      emoji: "🍎",
      shots: [{ source: 0, src: 2, dur: 2, framing: "window" }, { source: 0, src: 6, dur: 1, framing: "fill", crop_x: 0.2 }]
    }
  ],
  exclude_by_source: { "0": [[8, 9]] },
  canvas: [W, H],
  lufs: -14,
  ...overrides
})

const render = (p: RankingRenderPlan) =>
  Effect.runPromiseExit(Effect.gen(function*() {
    const engine = yield* RenderEngine
    return yield* engine.renderRanking(p, work, join(work, "out", "ranking-test.mp4"), () => Effect.void)
  }).pipe(Effect.provide(RenderEngine.layer)))

const renderError = async (p: RankingRenderPlan) => {
  const exit = await render(p)
  assert.ok(Exit.isFailure(exit))
  const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")
  assert.ok(error !== undefined && Schema.is(RenderError)(error.error), "fails with a RenderError")
  return error.error
}

// the colour of a small patch at (x, y) and time t
const pixel = (file: string, t: number, x: number, y: number) => {
  const rgb = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1",
    "-vf", `crop=8:8:${x - 4}:${y - 4},scale=1:1`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
  return { r: rgb[0]!, g: rgb[1]!, b: rgb[2]! }
}
// how many near-white pixels a region has (the list's white labels)
const whitePixels = (file: string, t: number, x: number, y: number, w: number, h: number) => {
  const rgb = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1",
    "-vf", `crop=${w}:${h}:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
  let n = 0
  for (let i = 0; i + 2 < rgb.length; i += 3) if (rgb[i]! > 220 && rgb[i + 1]! > 220 && rgb[i + 2]! > 220) n++
  return n
}
const isRed = ({ r, g, b }: { r: number; g: number; b: number }) => r > 120 && g < 80 && b < 80
const isBlue = ({ r, g, b }: { r: number; g: number; b: number }) => b > 150 && r < 90 && b > g + 60
const isGreen = ({ r, g, b }: { r: number; g: number; b: number }) => g > 70 && r < 60 && b < 60

// the audio's pitch over a stretch, from its zero crossings, and its peak level (0–1)
const audio = (file: string, t: number, seconds: number) => {
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", String(t), "-t", String(seconds), "-i", file, "-vn", "-ac", "1", "-ar", "48000",
    "-f", "s16le", "-"])
  let crossings = 0
  let peak = 0
  for (let i = 2; i + 1 < raw.length; i += 2) {
    const v = raw.readInt16LE(i)
    if ((raw.readInt16LE(i - 2) < 0) !== (v < 0)) crossings++
    peak = Math.max(peak, Math.abs(v) / 32768)
  }
  return { pitch: crossings / 2 / seconds, peak }
}

// a list row's label area: rows run from 0.215 to 0.70 of the height, 1 at the top
const rowY = (rank: number) => Math.round(H * 0.215 + (rank - 1) * ((H * 0.70 - H * 0.215) / 2))
const labelArea = (rank: number) => [40, rowY(rank) - 2, 120, 24] as const

test("plays each entry from its own video with its own sound, the list filling in, #1 last", { timeout: 120_000 }, async () => {
  const exit = await render(plan())
  assert.ok(Exit.isSuccess(exit), Exit.isFailure(exit) ? String(exit.cause) : "")
  const out = exit.value.output
  assert.equal(exit.value.shots, 4)
  assert.ok(Math.abs(exit.value.durationS - 7.5) < 0.05, `duration ${exit.value.durationS}`)
  assert.deepEqual(exit.value.timeline.map((e) => e.rank), [3, 2, 1])
  assert.deepEqual(exit.value.timeline.at(-1), { rank: 1, start: 5, end: 7.5 })

  // the footage, between list rows 2 and 3, in playing order
  const colours = [1, 2.5, 4, 6.5].map((t) => pixel(out, t, W / 2, 400))
  assert.ok(isRed(colours[0]!), `1s is #3 (red) ${JSON.stringify(colours[0])}`)
  assert.ok(isRed(colours[1]!), `2.5s is #3's second shot ${JSON.stringify(colours[1])}`)
  assert.ok(isBlue(colours[2]!), `4s is #2 (blue) ${JSON.stringify(colours[2])}`)
  assert.ok(isGreen(colours[3]!), `6.5s is #1 (green) ${JSON.stringify(colours[3])}`)

  // each clip's own sound: 300 Hz, then 800 Hz, then the silent video's silence
  assert.ok(Math.abs(audio(out, 0.3, 1.2).pitch - 300) < 40, "#3's sound")
  assert.ok(Math.abs(audio(out, 3.3, 1.2).pitch - 800) < 40, "#2's sound")
  assert.ok(audio(out, 5.4, 1.5).peak < 0.01, "#1's video has no sound")

  // the list: #3's label shows from the start, #1's only once #1 plays, and #3's stays
  const [x3, y3, w, h] = labelArea(3)
  const [x1, y1] = labelArea(1)
  assert.ok(whitePixels(out, 1, x3, y3, w, h) > 20, "#3's label is on its row while it plays")
  assert.equal(whitePixels(out, 1, x1, y1, w, h), 0, "#1's row is empty before #1 plays")
  assert.ok(whitePixels(out, 6.5, x1, y1, w, h) > 20, "#1's label appears when it plays")
  assert.ok(whitePixels(out, 6.5, x3, y3, w, h) > 20, "#3's label stays")

  // the checks of the finished mp4
  const checks = exit.value.checks
  assert.deepEqual(checks.black, [])
  assert.ok(checks.lufs !== null && Math.abs(checks.lufs + 14) < 1.5, `loudness ${checks.lufs}`)
  assert.equal(checks.frames.length, 4)
  assert.deepEqual(checks.frames.map((f) => [f.rank, f.shot]), [[3, 0], [3, 1], [2, 0], [1, 0]])
  for (const f of checks.frames) assert.ok(existsSync(f.first) && existsSync(f.last), `${f.first} and ${f.last}`)

  // the captions are each clip's own words at their places in the short
  const srt = readFileSync(exit.value.captions, "utf8")
  assert.match(srt, /00:00:00,200 --> .*\nRed starts\./)
  assert.match(srt, /00:00:03,200 --> .*\nBlue cares\./)
})

test("a shot inside its video's excluded range fails, naming the video", async () => {
  const error = await renderError(plan({ exclude_by_source: { "1": [[5, 6]] } }))
  assert.equal(error.code, "excluded-range")
  assert.match(error.message, /video 2 4\.0–6\.0s/)
})

test("an order that doesn't list every rank once fails", async () => {
  const error = await renderError(plan({ order: [3, 3, 1] }))
  assert.equal(error.code, "order")
})

test("a shot from a video the plan doesn't have fails", async () => {
  const error = await renderError(plan({ videos: [] }))
  assert.equal(error.code, "unknown-source")
})

test("a shot past the end of its video fails", async () => {
  const error = await renderError(plan({ items: [{ rank: 1, label: "Late", emoji: "⏰", shots: [{ source: 0, src: 9, dur: 3, framing: "fill" }] }], order: [1] }))
  assert.equal(error.code, "too-short")
})
