// A narrated ranking's rank cards (render-narrated.py's opt-in `rank_cards`): a big "#N" at the top of the band from the
// voiceover word the narrator says "Number" on, for 1.6 s, red with #1 yellow. Tiny generated media: a blue video and a
// silent 5 s voiceover, so the cards can be found by colour.
import type { NarratedPlan } from "@viral/contracts"
import { Effect, Exit } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
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
  work = realpathSync(mkdtempSync(join(tmpdir(), "viral-rank-cards-")))
  process.env.VIRAL_HOME = join(work, "home")
  ffmpeg("-f", "lavfi", "-i", "color=c=blue:s=320x180:d=8:r=25", "-f", "lavfi", "-i", "sine=f=800:d=8", "-shortest",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", join(work, "v1.mp4"))
  ffmpeg("-f", "lavfi", "-i", "sine=f=500:d=5", join(work, "vo.wav"))
  // "Hook. Number five, word word. Number one, word word."
  writeFileSync(join(work, "vo.json"), transcript(["Hook.", "Number", "five,", "word", "word.", "Number", "one,", "word", "word."].map((w, i) => said(w, i * 0.5))))
  writeFileSync(join(work, "v1.json"), transcript([said("Blue", 1), said("sky.", 1.5)]))
})
after(() => rmSync(work, { recursive: true, force: true }))

const plan = (overrides: Partial<NarratedPlan> = {}): NarratedPlan => ({
  slug: "rank-cards",
  source: join(work, "v1.mp4"),
  source_transcript: join(work, "v1.json"),
  voiceover: join(work, "vo.wav"),
  voiceover_transcript: join(work, "vo.json"),
  canvas: [360, 640],
  main_height: 400,
  captions: false,
  shots: [{ src: 0.5, word: 0, word_text: "Hook." }, { src: 2, word: 5, word_text: "Number" }],
  lufs: -14,
  ...overrides
})

const frame = (file: string, t: number) => {
  const [w, h] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file])
    .toString().trim().split(",").map(Number) as [number, number]
  const raw = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 64 * 1024 * 1024 })
  return { w, h, at: (x: number, y: number) => [raw[(y * w + x) * 3]!, raw[(y * w + x) * 3 + 1]!, raw[(y * w + x) * 3 + 2]!] as const }
}
// how much of the band's top (where the card sits: y 0.16 of the 400 px band, i.e. rows 0.2–0.37 of the frame) is a colour
const share = (file: string, t: number, is: (rgb: readonly [number, number, number]) => boolean) => {
  const f = frame(file, t)
  let n = 0, hit = 0
  for (let y = Math.floor(0.2 * f.h); y < Math.floor(0.37 * f.h); y++) {
    for (let x = 0; x < f.w; x++, n++) if (is(f.at(x, y))) hit++
  }
  return hit / n
}
const red = ([r, g, b]: readonly [number, number, number]) => r > 170 && g < 90 && b < 110
const yellow = ([r, g, b]: readonly [number, number, number]) => r > 200 && g > 170 && b < 90

const render = (p: NarratedPlan, name: string) =>
  Effect.runPromiseExit(Effect.gen(function*() {
    mkdirSync(join(work, name), { recursive: true })
    return yield* (yield* RenderEngine).renderNarrated(p, join(work, name), join(work, name, `${name}.mp4`), () => Effect.void)
  }).pipe(Effect.provide(RenderEngine.layer)))

test("rank cards: #5 in red on its \"Number\" for 1.6 s, #1 in yellow; none before, between or without the key", { timeout: 180_000 }, async () => {
  const exit = await render(plan({ rank_cards: [{ rank: 5, word: 1, word_text: "Number" }, { rank: 1, word: 5, word_text: "Number" }] }), "cards")
  assert.ok(Exit.isSuccess(exit), Exit.isFailure(exit) ? String(exit.cause) : "")
  const out = exit.value.output
  assert.equal(share(out, 0.25, red), 0, "no card during the hook")
  assert.ok(share(out, 0.9, red) > 0.02, "#5 in red at the top of the band")
  assert.equal(share(out, 0.9, yellow), 0)
  assert.equal(share(out, 2.3, red), 0, "gone after 1.6 s")
  assert.ok(share(out, 2.9, yellow) > 0.02, "#1 in yellow")
  const plain = await render(plan(), "plain")
  assert.ok(Exit.isSuccess(plain), Exit.isFailure(plain) ? String(plain.cause) : "")
  assert.equal(share(plain.value.output, 0.9, red), 0, "absent key = no cards")
})

test("rank cards: a card whose word doesn't match the voiceover fails the render", { timeout: 60_000 }, async () => {
  const exit = await render(plan({ rank_cards: [{ rank: 5, word: 2, word_text: "Number" }] }), "mismatch")
  assert.ok(Exit.isFailure(exit))
  assert.match(String(exit.cause), /anchor-mismatch|plan expects 'Number'/)
})
