import type { CutRenderPlan } from "@viral/contracts"
import { Effect, Exit, Schema } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { RenderEngine, RenderError } from "./render-engine.ts"

let work: string
before(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "viral-cut-")))
  process.env.VIRAL_HOME = join(work, "home")
  // 20s of 16:9 test footage with a tone, small so the cuts are quick
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=d=20:s=320x180:r=25", "-f", "lavfi", "-i", "sine=f=300:d=20",
    "-shortest", "-c:v", "libx264", "-c:a", "aac", join(work, "source.mp4")])
  const w = (word: string, s: number) => ({ w: word, s, e: s + 0.4 })
  const words = [w("This", 2), w("is", 2.5), w("the", 3), w("hook.", 3.5), w("Then", 10), w("it", 10.5), w("worked.", 11)]
  writeFileSync(join(work, "transcript.json"), JSON.stringify({
    source: "source.mp4",
    language: "en",
    segments: [{ start: 2, end: 11.4, text: words.map((x) => x.w).join(" "), words }]
  }))
})
after(() => rmSync(work, { recursive: true, force: true }))

const plan = (overrides: Partial<CutRenderPlan> = {}): CutRenderPlan => ({
  slug: "03-cut",
  source: join(work, "source.mp4"),
  transcript: join(work, "transcript.json"),
  framing: "blur",
  captions: true,
  caption_y: 0.7,
  caption_highlight: "#FFD400",
  hook_text: "Does it work?",
  credit: "Video: Test",
  exclude: [[0, 1]],
  // out of source order: the payoff line plays first as the hook
  sections: [
    { beat: "hook", start: 10, end: 11.4 },
    { beat: "rising_action", start: 2, end: 3.9, framing: "crop", crop_x: 0.3 }
  ],
  lufs: -14,
  ...overrides
})

const render = (p: CutRenderPlan) =>
  Effect.runPromiseExit(Effect.gen(function*() {
    const engine = yield* RenderEngine
    return yield* engine.renderCut(p, work, join(work, "out", "03-cut.mp4"), () => Effect.void)
  }).pipe(Effect.provide(RenderEngine.layer)))

test("cuts the sections in plan order, snapped to whole words, with captions, the hook card and a credit", async () => {
  const exit = await render(plan())
  assert.ok(Exit.isSuccess(exit), Exit.isFailure(exit) ? String(exit.cause) : "")
  const result = exit.value
  assert.equal(result.sections, 2)
  // each section grows by its snap margins (0.06s before, 0.15s after)
  assert.ok(Math.abs(result.durationS - ((11.4 - 10 + 0.21) + (3.9 - 2 + 0.21))) < 0.05, `duration ${result.durationS}`)
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", result.output]))
  assert.ok(Math.abs(seconds - result.durationS) < 0.15, `file is ${seconds}s`)
  const size = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", result.output]).toString().trim()
  assert.equal(size, "1080,1920")
  // the srt starts with the hook's words, which play first
  assert.ok(existsSync(result.captions))
  assert.match(readFileSync(result.captions, "utf8"), /^1\n00:00:00,\d{3} --> .*\nThen it worked\./)
})

test("a section touching an excluded range fails before anything is cut", async () => {
  const exit = await render(plan({ sections: [{ beat: "hook", start: 0.5, end: 3 }] }))
  assert.ok(Exit.isFailure(exit))
  const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")
  assert.ok(error !== undefined && Schema.is(RenderError)(error.error))
  assert.equal(error.error.code, "excluded-range")
})
