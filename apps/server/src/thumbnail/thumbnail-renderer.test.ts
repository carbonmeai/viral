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

// Fake cut-out scripts, so every path runs without Vision or rembg: FAKE_CUT=ok keeps an ellipse (about half the
// image), "empty" keeps almost nothing, "fail" writes nothing.
const fakeCutout = (argsPerImage: 2 | 3, skip: number) => `# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
import json, os, sys
from PIL import Image, ImageDraw
mode = os.environ.get("FAKE_CUT", "ok")
args = sys.argv[1 + ${skip}:]
for i in range(0, len(args), ${argsPerImage}):
    src, out = args[i], args[i + 1]
    if mode == "fail":
        print(json.dumps({"type": "error", "code": "cutout", "message": "fake failure"}))
        continue
    img = Image.open(src).convert("RGBA")
    mask = Image.new("L", img.size, 0)
    w, h = img.size
    if mode == "ok":
        ImageDraw.Draw(mask).ellipse((w * 0.1, h * 0.1, w * 0.9, h * 0.9), fill=255)
    img.putalpha(mask)
    img.save(out)
    kept = sum(1 for a in mask.getdata() if a > 127) / (w * h)
    print(json.dumps({"type": "cutout", "out": out, "coverage": round(kept, 3)}))
`

test("bold cut-outs: Apple's first, rembg only when its models are on disk, a framed inset otherwise", async () => {
  const fakes = join(dir, "fakes")
  mkdirSync(fakes, { recursive: true })
  writeFileSync(join(fakes, "apple.py"), fakeCutout(2, 0))
  writeFileSync(join(fakes, "rembg.py"), fakeCutout(3, 1))
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
  const keys = ["VIRAL_CUTOUT", "VIRAL_CUTOUT_APPLE", "VIRAL_CUTOUT_APPLE_SCRIPT", "VIRAL_CUTOUT_REMBG_SCRIPT", "VIRAL_MODELS_DIR", "FAKE_CUT"]
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  const cutoutsWith = async (env: Record<string, string>, name: string) => {
    for (const k of keys) delete process.env[k]
    Object.assign(process.env, { VIRAL_CUTOUT_APPLE_SCRIPT: join(fakes, "apple.py"), VIRAL_CUTOUT_REMBG_SCRIPT: join(fakes, "rembg.py") }, env)
    const drawn = await run((r) => r.render(bold, join(dir, `${name}.jpg`)))
    return drawn.cutouts
  }
  try {
    assert.deepEqual(await cutoutsWith({ VIRAL_CUTOUT_APPLE: "on", VIRAL_MODELS_DIR: withoutModels, FAKE_CUT: "ok" }, "apple"),
      { hero: "apple", face: "apple" }, "Apple's cut-out needs no models")

    // Apple fails; rembg's fake runs from the same FAKE_CUT, so point Apple at a script that always fails
    writeFileSync(join(fakes, "apple-fails.py"), fakeCutout(2, 0).replace('mode = os.environ.get("FAKE_CUT", "ok")', 'mode = "fail"'))
    const appleFails = { VIRAL_CUTOUT_APPLE: "on", VIRAL_CUTOUT_APPLE_SCRIPT: join(fakes, "apple-fails.py") }
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
