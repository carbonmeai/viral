// Golden check: transcribe the first 30s of the candy video with every available provider and compare
// with the original Whisper transcript. Needs `bun run fixtures:sync`; Grok runs only with an xAI key.
import type { Transcript } from "@viral/contracts"
import { ConfigProvider, Effect, Layer } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Transcriber } from "./transcriber.ts"

const FIXTURE = join(homedir(), ".viral/fixtures/candy")
const hasFixture = existsSync(join(FIXTURE, "source.mp4"))
const CLIP_S = 30

let work: string
let clip: string
before(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "viral-transcribe-")))
  process.env.VIRAL_HOME = join(work, "home")
  clip = join(work, "clip.mp4")
  if (hasFixture) {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", join(FIXTURE, "source.mp4"), "-t", String(CLIP_S), "-c", "copy", clip])
  }
})
after(() => rmSync(work, { recursive: true, force: true }))

const norm = (w: string) => w.toLowerCase().replace(/[^\w]/g, "")
const reference = () => {
  const original = JSON.parse(readFileSync(join(FIXTURE, "transcript.json"), "utf8")) as Transcript
  return original.segments.flatMap((s) => s.words).filter((w) => w.e <= CLIP_S - 1)
}

// Matches words in order against the original and reports how far their start times drift.
const compare = (transcript: Transcript) => {
  const ref = reference()
  const words = transcript.segments.flatMap((s) => s.words)
  const drift: Array<number> = []
  const signed: Array<number> = []
  let j = 0
  for (const word of words) {
    const k = ref.findIndex((r, i) => i >= j && norm(r.w) === norm(word.w))
    if (k >= 0 && k - j < 4) {
      drift.push(Math.abs(ref[k]!.s - word.s))
      signed.push(word.s - ref[k]!.s)
      j = k + 1
    }
  }
  drift.sort((a, b) => a - b)
  signed.sort((a, b) => a - b)
  const median = (xs: ReadonlyArray<number>) => xs[Math.floor(xs.length / 2)] ?? Infinity
  return {
    words: words.length,
    matched: drift.length / ref.length,
    medianDrift: median(drift),
    // positive = later than Whisper; a constant offset is a timing convention, not noise
    signedMedian: median(signed),
    p90Drift: drift[Math.floor(drift.length * 0.9)] ?? Infinity
  }
}

// Effect's default config provider snapshots process.env once, so each run gets its own environment.
const envWith = (overrides: Record<string, string>) =>
  ConfigProvider.fromEnv({
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      ...overrides
    }
  })

const transcribeWith = (provider: "grok" | "whisper-local") => {
  const out = join(work, provider)
  mkdirSync(out, { recursive: true })
  return Effect.runPromise(Effect.gen(function*() {
    return yield* (yield* Transcriber).transcribe(clip, out, () => Effect.void)
  }).pipe(
    Effect.provide(Transcriber.layer.pipe(Layer.provide(ConfigProvider.layer(envWith({ VIRAL_TRANSCRIBER: provider })))))
  )).then((result) => ({
    result,
    transcript: JSON.parse(readFileSync(join(out, "transcript.json"), "utf8")) as Transcript
  }))
}

for (const provider of ["whisper-local", "grok"] as const) {
  const skip = !hasFixture || (provider === "grok" && process.env.XAI_API_KEY === undefined)
    || (provider === "whisper-local" && !(process.platform === "darwin" && process.arch === "arm64"))
  test(`${provider} transcribes the candy intro with word timings`, { skip, timeout: 10 * 60_000 }, async () => {
    const { result, transcript } = await transcribeWith(provider)
    const report = compare(transcript)
    console.log(JSON.stringify({ ...result, ...report }))

    assert.equal(result.provider, provider)
    assert.equal(transcript.provider, provider)
    assert.match(transcript.segments.map((s) => s.text).join(" "), /sponsored by Brilliant/i)
    assert.ok(report.matched > 0.8, `matched ${(report.matched * 100).toFixed(0)}% of the original words`)
    // The reference is the original Whisper transcript. Grok finds the same words but places word starts
    // consistently ~0.2s later than Whisper (measured on this clip: median +0.19s, p90 0.45s); which of the
    // two is closer to the true onset is not settled, so Grok is held to its observed spread.
    const limits = provider === "whisper-local" ? { median: 0.15, p90: 0.3 } : { median: 0.3, p90: 0.6 }
    assert.ok(report.medianDrift < limits.median, `median word-start drift ${report.medianDrift}s`)
    assert.ok(report.p90Drift < limits.p90, `p90 word-start drift ${report.p90Drift}s`)
  })
}
