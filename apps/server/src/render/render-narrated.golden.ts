// Golden check: rendering the candy short's saved plan through the server must reproduce the original.
// Slow (a full render), so it runs on its own: `bun run test:golden`. Needs `bun run fixtures:sync`.
import { NarratedPlan } from "@viral/contracts"
import { Effect, Schema } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { RenderEngine } from "./render-engine.ts"

const FIXTURE = join(homedir(), ".viral/fixtures/candy")
const GOLDEN = join(FIXTURE, "golden/01-every-taste-candy")
const hasFixture = existsSync(join(FIXTURE, "source.mp4")) && existsSync(`${GOLDEN}.mp4`)

// Hamming distance out of 64. Re-encodes differ by a few bits; a wrong shot, crop or caption by far more.
const MAX_FRAME_DISTANCE = 6
const FRAME = 1 / 30

let work: string
before(() => {
  // realpath: on macOS the temp dir is a symlink (/var -> /private/var) and the script reports the real path
  work = realpathSync(mkdtempSync(join(tmpdir(), "viral-golden-")))
  process.env.VIRAL_HOME = join(work, "home")
})
after(() => rmSync(work, { recursive: true, force: true }))

// The saved plan, with its file references pointed at the fixture copies.
const candyPlan = (): NarratedPlan => {
  const plan = Schema.decodeUnknownSync(NarratedPlan)(JSON.parse(readFileSync(join(FIXTURE, "narrated.json"), "utf8")))
  const music = typeof plan.music === "object" ? { ...plan.music, file: join(FIXTURE, "music/viral_drop_song.wav") } : plan.music
  return {
    ...plan,
    source: join(FIXTURE, "source.mp4"),
    source_transcript: join(FIXTURE, "transcript.json"),
    voiceover: join(FIXTURE, "vo.wav"),
    voiceover_transcript: join(FIXTURE, "vo_tx/transcript.json"),
    ...(music === undefined ? {} : { music })
  }
}

test("re-rendering the candy plan reproduces the original short", { skip: !hasFixture, timeout: 15 * 60_000 }, async () => {
  const out = join(work, "01-every-taste-candy.mp4")
  const progress: Array<number> = []
  const result = await Effect.runPromise(Effect.gen(function*() {
    const render = yield* RenderEngine
    return yield* render.renderNarrated(candyPlan(), work, out, (event) =>
      Effect.sync(() => {
        if (event._tag === "Progress") progress.push(event.pct)
      }))
  }).pipe(Effect.provide(RenderEngine.layer)))

  assert.equal(result.output, out)
  assert.ok(progress.length > 10 && progress.every((pct, i) => i === 0 || pct >= progress[i - 1]!), "progress only moves forward")

  assert.equal(readFileSync(result.captions, "utf8"), readFileSync(`${GOLDEN}.srt`, "utf8"), "captions are identical")

  const report = JSON.parse(execFileSync("uv", [
    "run", "--script", join(import.meta.dirname, "testing/compare-renders.py"), `${GOLDEN}.mp4`, out
  ], { encoding: "utf8" })) as {
    duration: [number, number]
    video_frames: [number, number]
    audio_duration: [number, number]
    samples: Array<{ t: number; distance: number }>
  }
  console.log(JSON.stringify({ ...report, samples: report.samples.map((s) => s.distance) }))

  assert.ok(Math.abs(report.duration[0] - report.duration[1]) <= FRAME, `duration ${report.duration}`)
  assert.equal(report.video_frames[1], report.video_frames[0], "frame count")
  assert.ok(Math.abs(report.audio_duration[0] - report.audio_duration[1]) <= 0.05, `audio ${report.audio_duration}`)
  const off = report.samples.filter((s) => s.distance > MAX_FRAME_DISTANCE)
  assert.deepEqual(off, [], "every sampled frame matches the original")
})
