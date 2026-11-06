import { Effect } from "effect"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { TrackAnalyser } from "./track-analyser.ts"

// Runs the real analyse-track.py (librosa): synthetic tracks with a known tempo and drop, and the candy short's
// track, whose tempo and drop were measured by hand.
let dir: string
before(() => {
  dir = mkdtempSync(join(tmpdir(), "viral-analyse-"))
})
after(() => rmSync(dir, { recursive: true, force: true }))

const RATE = 44100

// A mono 16-bit WAV: a hi-hat (a short noise burst) on every beat throughout; from `dropS` on, a kick (a
// decaying 55 Hz thump) on every beat and a sustained 45 Hz bass. With dropS null the bass is there from the start.
const synth = (seconds: number, bpm: number, dropS: number | null) => {
  const n = Math.round(seconds * RATE)
  const samples = new Float32Array(n)
  const beat = 60 / bpm
  let seed = 1
  const noise = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647 * 2 - 1
  }
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    const sinceBeat = t % beat
    let v = 0.15 * noise() * Math.exp(-sinceBeat / 0.02)
    const bassOn = dropS === null || t >= dropS
    if (bassOn) {
      v += 0.6 * Math.sin(2 * Math.PI * 55 * sinceBeat) * Math.exp(-sinceBeat / 0.18)
      v += 0.25 * Math.sin(2 * Math.PI * 45 * t)
    }
    samples[i] = Math.max(-1, Math.min(1, v))
  }
  const data = Buffer.alloc(44 + n * 2)
  data.write("RIFF", 0)
  data.writeUInt32LE(36 + n * 2, 4)
  data.write("WAVEfmt ", 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(RATE, 24)
  data.writeUInt32LE(RATE * 2, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write("data", 36)
  data.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(samples[i]! * 32767), 44 + i * 2)
  return data
}

const analyse = (file: string) =>
  Effect.runPromise(Effect.gen(function*() {
    return yield* (yield* TrackAnalyser).analyse(file)
  }).pipe(Effect.provide(TrackAnalyser.layer)))

test("a synthetic track: tempo within 2 BPM and the drop within a quarter second", async (t) => {
  const file = join(dir, "drop.wav")
  writeFileSync(file, synth(30, 120, 12))
  const result = await analyse(file)
  t.diagnostic(`measured ${JSON.stringify(result)} (made at 120 BPM, drop 12 s)`)
  assert.ok(result.bpm !== null && Math.abs(result.bpm - 120) <= 2, `bpm ${result.bpm}`)
  assert.ok(result.dropS !== null && Math.abs(result.dropS - 12) <= 0.25, `drop ${result.dropS}`)
  assert.ok(Math.abs(result.durationS - 30) < 0.05)
  assert.ok(result.loudnessLufs !== null)
})

test("a track whose bass never jumps has no drop", async (t) => {
  const file = join(dir, "steady.wav")
  writeFileSync(file, synth(30, 100, null))
  const result = await analyse(file)
  t.diagnostic(`measured ${JSON.stringify(result)} (made at 100 BPM, no drop)`)
  assert.equal(result.dropS, null, `confidence ${result.confidence}`)
})

const candy = join(homedir(), ".viral", "fixtures", "candy", "music", "viral_drop_song.wav")
test("the candy short's track matches its hand measurement (117.5 BPM, drop 16.588 s) within a beat", { skip: !existsSync(candy) }, async (t) => {
  const result = await analyse(candy)
  t.diagnostic(`measured ${JSON.stringify(result)}`)
  const beat = 60 / 117.5
  assert.ok(result.bpm !== null && Math.abs(result.bpm - 117.5) <= 2, `bpm ${result.bpm}`)
  assert.ok(result.dropS !== null && Math.abs(result.dropS - 16.588) <= beat, `drop ${result.dropS}`)
})
