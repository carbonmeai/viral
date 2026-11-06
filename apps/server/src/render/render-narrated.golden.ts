// Golden check: rendering the candy short's saved plan through the server must reproduce the original.
// Slow (a full render), so it runs on its own: `bun run test:golden`. Needs `bun run fixtures:sync`.
import { NarratedPlan } from "@viral/contracts"
import { Effect, Schema } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
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

type Report = {
  duration: [number, number]
  video_frames: [number, number]
  audio_duration: [number, number]
  samples: Array<{ t: number; distance: number }>
}

// Duration, frame count and audio length match, and every sampled frame looks the same.
const compareRenders = (golden: string, actual: string) => {
  const report = JSON.parse(execFileSync("uv", [
    "run", "--script", join(import.meta.dirname, "testing/compare-renders.py"), golden, actual
  ], { encoding: "utf8" })) as Report
  console.log(JSON.stringify({ ...report, samples: report.samples.map((s) => s.distance) }))
  assert.ok(Math.abs(report.duration[0] - report.duration[1]) <= FRAME, `duration ${report.duration}`)
  assert.equal(report.video_frames[1], report.video_frames[0], "frame count")
  assert.ok(Math.abs(report.audio_duration[0] - report.audio_duration[1]) <= 0.05, `audio ${report.audio_duration}`)
  const off = report.samples.filter((s) => s.distance > MAX_FRAME_DISTANCE)
  assert.deepEqual(off, [], "every sampled frame matches the golden")
}

const render = (plan: NarratedPlan, out: string) => {
  const progress: Array<number> = []
  return Effect.runPromise(Effect.gen(function*() {
    const engine = yield* RenderEngine
    return yield* engine.renderNarrated(plan, work, out, (event) =>
      Effect.sync(() => {
        if (event._tag === "Progress") progress.push(event.pct)
      }))
  }).pipe(Effect.provide(RenderEngine.layer))).then((result) => ({ result, progress }))
}

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
  const { result, progress } = await render(candyPlan(), out)

  assert.equal(result.output, out)
  assert.ok(progress.length > 10 && progress.every((pct, i) => i === 0 || pct >= progress[i - 1]!), "progress only moves forward")

  assert.equal(readFileSync(result.captions, "utf8"), readFileSync(`${GOLDEN}.srt`, "utf8"), "captions are identical")

  compareRenders(`${GOLDEN}.mp4`, out)
})

// The approaches-and-styles features on the same footage: full-bleed framing, a pinned headline, chunk
// captions, quote boxes, a label, the credit, and two real reactions inserted mid-narration. This golden is
// a snapshot of our own render, approved by eye (2026-11-06); refresh it on purpose with
// VIRAL_UPDATE_GOLDEN=1 after an intended style change.
const FEATURES_GOLDEN = join(FIXTURE, "golden/candy-features")

const featuresPlan = (): NarratedPlan => {
  const plan = candyPlan()
  return {
    ...plan,
    slug: "candy-features",
    framing: "full",
    caption_mode: "chunk",
    caption_max_words: 3,
    caption_case: "upper",
    caption_y: 0.74,
    quote_box: true,
    credit: "Video: NileBlue",
    headline: { lines: [{ text: "EXTREME CANDY" }, { text: "THAT BREAKS YOUR BRAIN?" }] },
    inserts: [
      { start: 1143.5, end: 1146.0, after_word: 60, after_word_text: "capsaicin." },
      { start: 1525.8, end: 1532.6, after_word: 93, after_word_text: "worked." }
    ],
    annotations: [
      ...(plan.annotations ?? []),
      { type: "label", text: "sticky", word: 80, word_text: "sticky", dur: 1.6, x: 0.5, y: 0.3 }
    ]
  }
}

test("features render: inserts, full-bleed, headline, chunk and quote captions", { skip: !hasFixture, timeout: 15 * 60_000 }, async () => {
  const out = join(work, "candy-features.mp4")
  const { result } = await render(featuresPlan(), out)

  // narration 40.588s + inserts 2.5s and 6.8s + outro 6.6s
  assert.ok(Math.abs(result.durationS - 56.488) < 0.01, `duration ${result.durationS}`)
  const captions = readFileSync(result.captions, "utf8")
  assert.match(captions, /00:00:20,220 --> 00:00:20,640\npain\./, "the first insert's words are timed after the pause")

  if (process.env.VIRAL_UPDATE_GOLDEN === "1" || !existsSync(`${FEATURES_GOLDEN}.mp4`)) {
    copyFileSync(out, `${FEATURES_GOLDEN}.mp4`)
    copyFileSync(result.captions, `${FEATURES_GOLDEN}.srt`)
    console.log(`wrote golden ${FEATURES_GOLDEN}.mp4`)
    return
  }
  assert.equal(captions, readFileSync(`${FEATURES_GOLDEN}.srt`, "utf8"), "captions are identical")
  compareRenders(`${FEATURES_GOLDEN}.mp4`, out)
})
