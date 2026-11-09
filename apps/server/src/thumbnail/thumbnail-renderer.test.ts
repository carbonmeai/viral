import { Effect } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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
  const drawn = await run((r) => r.render({ ...config, source: video }, join(dir, "thumb.jpg")))
  assert.equal(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", drawn.image]).toString().trim(), "1080,1920")
  assert.deepEqual(drawn.cutouts, {}, "classic cuts nothing out")
})

test("a crop outside the frame fails with the script's code", async () => {
  const error = await run((r) => Effect.flip(r.render({ ...config, source: video, hero: { ...config.hero, box: [0, 0, 900, 480] } }, join(dir, "bad.jpg"))))
  assert.equal(error.code, "crop")
  assert.match(error.message, /outside the 854x480 frame/)
})

test("the bold layout draws, falling back to framed insets when cut-outs aren't available", async () => {
  const saved = process.env["VIRAL_CUTOUT"]
  process.env["VIRAL_CUTOUT"] = "off"
  try {
    const bold = {
      ...config,
      layout: "bold" as const,
      source: video,
      backdrop: { colors: ["#FF3B30", "#3A0000"] as const, burst: true },
      inset: { src: 3, box: [300, 0, 600, 480] as const, y: 1, height: 0.5, side: "right" as const, x: 0.74 },
      arrow: true,
      emoji: { char: "🤢", x: 0.2, y: 0.78, size: 250 }
    }
    const drawn = await run((r) => r.render(bold, join(dir, "bold.jpg")))
    assert.equal(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", drawn.image]).toString().trim(), "1080,1920")
    // the script says how each layer was drawn
    const lines = execFileSync("uv", ["run", "--quiet", "--script", join(import.meta.dirname, "render-thumbnail.py"), join(dir, "bold.json"), "--out", join(dir, "bold2.jpg")], {
      env: { ...process.env, VIRAL_CUTOUT: "off" }
    }).toString()
    const done = JSON.parse(lines.trim().split("\n").at(-1)!)
    assert.match(done.cutouts.hero, /^fallback/)
    assert.match(done.cutouts.face, /^fallback/)
  } finally {
    if (saved === undefined) delete process.env["VIRAL_CUTOUT"]
    else process.env["VIRAL_CUTOUT"] = saved
  }
})

// The fake cut-out script (testing/fake-cutout.py) stands in for both Apple's and rembg's, so every path runs without
// Vision or rembg: FAKE_CUT=ok keeps an ellipse (about half the image), "empty" keeps almost nothing, "fail" writes
// nothing; FAKE_CUT_APPLE overrides it for Apple's.
const FAKE_CUTOUT = join(import.meta.dirname, "testing", "fake-cutout.py")

test("bold cut-outs: Apple's first, rembg only when its models are on disk, a framed inset otherwise", async () => {
  const withModels = join(dir, "models-in")
  const withoutModels = join(dir, "models-out")
  mkdirSync(withModels, { recursive: true })
  mkdirSync(withoutModels, { recursive: true })
  for (const model of ["isnet-general-use", "u2net_human_seg"]) writeFileSync(join(withModels, `${model}.onnx`), "fake")

  const bold = {
    ...config,
    layout: "bold" as const,
    source: video,
    backdrop: { colors: ["#FF3B30", "#3A0000"] as const, burst: true },
    inset: { src: 3, box: [300, 0, 600, 480] as const, y: 1, height: 0.5, side: "right" as const, x: 0.74 },
    arrow: false
  }
  const keys = ["VIRAL_CUTOUT", "VIRAL_CUTOUT_APPLE", "VIRAL_CUTOUT_APPLE_SCRIPT", "VIRAL_CUTOUT_REMBG_SCRIPT", "VIRAL_MODELS_DIR", "FAKE_CUT", "FAKE_CUT_APPLE"]
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  const cutoutsWith = async (env: Record<string, string>, name: string) => {
    for (const k of keys) delete process.env[k]
    Object.assign(process.env, { VIRAL_CUTOUT_APPLE_SCRIPT: FAKE_CUTOUT, VIRAL_CUTOUT_REMBG_SCRIPT: FAKE_CUTOUT }, env)
    const drawn = await run((r) => r.render(bold, join(dir, `${name}.jpg`)))
    return drawn.cutouts
  }
  try {
    assert.deepEqual(await cutoutsWith({ VIRAL_CUTOUT_APPLE: "on", VIRAL_MODELS_DIR: withoutModels, FAKE_CUT: "ok" }, "apple"),
      { hero: "apple", face: "apple" }, "Apple's cut-out needs no models")

    // Apple fails while rembg's fake follows FAKE_CUT
    const appleFails = { VIRAL_CUTOUT_APPLE: "on", FAKE_CUT_APPLE: "fail" }
    assert.deepEqual(await cutoutsWith({ ...appleFails, VIRAL_MODELS_DIR: withModels, FAKE_CUT: "ok" }, "rembg"),
      { hero: "rembg", face: "rembg" }, "rembg takes over when its models are there")
    assert.deepEqual(await cutoutsWith({ ...appleFails, VIRAL_MODELS_DIR: withoutModels, FAKE_CUT: "ok" }, "needs"),
      { hero: "fallback: needs rembg models", face: "fallback: needs rembg models" }, "without the models, the caller is told to fetch them")
    assert.deepEqual(await cutoutsWith({ ...appleFails, VIRAL_MODELS_DIR: withModels, FAKE_CUT: "empty" }, "nothing"),
      { hero: "fallback: no clear subject", face: "fallback: no clear subject" }, "both failing leaves framed insets")
    assert.deepEqual(await cutoutsWith({ VIRAL_CUTOUT_APPLE: "off", VIRAL_MODELS_DIR: withoutModels, FAKE_CUT: "ok" }, "no-apple"),
      { hero: "fallback: needs rembg models", face: "fallback: needs rembg models" }, "no Apple cut-out (not a Mac) goes to rembg")
    assert.deepEqual(await cutoutsWith({ VIRAL_CUTOUT: "off", VIRAL_CUTOUT_APPLE: "on", FAKE_CUT: "ok" }, "off"),
      { hero: "fallback: cut-outs are off", face: "fallback: cut-outs are off" }, "VIRAL_CUTOUT=off still forces framed insets")
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
})

// The pixel at (x, y) of a jpg, as [r, g, b].
const pixel = (image: string, x: number, y: number) => {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", image, "-vf", `crop=2:2:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
  return [raw[0]!, raw[1]!, raw[2]!] as const
}

test("a short from several videos: each layer is cut from its own video", async () => {
  const red = join(dir, "red.mp4")
  const blue = join(dir, "blue.mp4")
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:d=5:s=854x480:r=10", red])
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:d=5:s=640x360:r=10", blue])
  const two = {
    ...config,
    source: red,
    sources: [blue],
    // the face from V2, in V2's pixels; the hero and the background from V1
    inset: { ...config.inset, source: 1, box: [100, 0, 540, 360] as const }
  }
  const drawn = await run((r) => r.render(two, join(dir, "two.jpg")))
  const [hr, , hb] = pixel(drawn.image, 540, Math.round(1920 * 0.45))
  const [fr, , fb] = pixel(drawn.image, Math.round(1080 * 0.64), Math.round(1920 * 0.79))
  assert.ok(hr > 180 && hb < 80, `the hero is V1's red, got ${hr},${hb}`)
  assert.ok(fb > 180 && fr < 80, `the face is V2's blue, got ${fr},${fb}`)

  const unknown = await run((r) => Effect.flip(r.render({ ...two, hero: { ...two.hero, source: 2 } }, join(dir, "unknown.jpg"))))
  assert.equal(unknown.code, "unknown-source")
})

// A video read from a 480p scan gives its frames from its 1080p pieces: the scan is red at 160×90, its piece from 1 s
// to 4 s is green on the left half and blue on the right at 640×360. The hero's box is the scan's right half, in the
// scan's pixels, so it must be scaled to the piece to show the piece's right half (blue).
test("a layer covered by a piece is cut from the piece, its box scaled from the scan's pixels to the piece's", async () => {
  const scan = join(dir, "scan.mp4")
  const piece = join(dir, "piece-1-4.mp4")
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=160x90:d=5:r=10", "-pix_fmt", "yuv420p", scan])
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=green:s=640x360:d=3:r=10,drawbox=x=320:y=0:w=320:h=360:color=blue:t=fill",
    "-pix_fmt", "yuv420p", piece])
  const thumb = { source: scan, background: { src: 2 }, hero: { src: 2, box: [80, 0, 160, 90] as const, y: 0.45, width: 0.5 }, lines: [{ text: "HI" }] }
  const centre = (image: string) => {
    const rgb = execFileSync("ffmpeg", ["-loglevel", "error", "-i", image, "-vf", "crop=8:8:536:860,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
    return { r: rgb[0]!, g: rgb[1]!, b: rgb[2]! }
  }
  const fromPiece = centre((await run((r) => r.render({ ...thumb, pieces_by_source: { "0": [{ path: piece, start: 1, end: 4 }] } }, join(dir, "piece.jpg")))).image)
  assert.ok(fromPiece.b > 150 && fromPiece.r < 80 && fromPiece.g < 80, `the piece's right half: ${JSON.stringify(fromPiece)}`)
  const fromScan = centre((await run((r) => r.render(thumb, join(dir, "scan.jpg")))).image)
  assert.ok(fromScan.r > 150 && fromScan.g < 80 && fromScan.b < 80, `without pieces, the scan: ${JSON.stringify(fromScan)}`)
})
