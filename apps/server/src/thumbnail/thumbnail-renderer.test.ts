import { Effect } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { ThumbnailRenderer } from "./thumbnail-renderer.ts"

let dir: string
let video: string
before(() => {
  dir = mkdtempSync(join(tmpdir(), "viral-thumb-render-"))
  video = join(dir, "source.mp4")
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=d=10:s=854x480:r=10", video])
})
after(() => rmSync(dir, { recursive: true, force: true }))

const run = <A, E>(use: (renderer: ThumbnailRenderer["Service"]) => Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flatMap(ThumbnailRenderer, use).pipe(Effect.provide(ThumbnailRenderer.layer)))

const config = {
  source: "",
  background: { src: 1 },
  hero: { src: 2, box: [100, 0, 740, 480] as const, y: 0.45, width: 0.92, circle: true },
  inset: { src: 3, box: [230, 0, 710, 430] as const, y: 0.79, x: 0.64, width: 0.58, tilt: -4 },
  lines: [{ text: "7 TASTES", color: "#FFD400", size: 220 }, { text: "1 CANDY", color: "#FFFFFF", size: 180 }],
  arrow: false
}

test("reads the video's size and length, and draws a 1080×1920 thumbnail", async () => {
  const probed = await run((r) => r.probe(video))
  assert.deepEqual({ ...probed, durationS: Math.round(probed.durationS) }, { width: 854, height: 480, durationS: 10 })
  const out = await run((r) => r.render({ ...config, source: video }, join(dir, "thumb.jpg")))
  assert.equal(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", out]).toString().trim(), "1080,1920")
})

test("a crop outside the frame fails with the script's code", async () => {
  const error = await run((r) => Effect.flip(r.render({ ...config, source: video, hero: { ...config.hero, box: [0, 0, 900, 480] } }, join(dir, "bad.jpg"))))
  assert.equal(error.code, "crop")
  assert.match(error.message, /outside the 854x480 frame/)
})
