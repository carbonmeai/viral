import { NodeServices } from "@effect/platform-node"
import { Effect, Option } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { MAX_EDGE, modelImageReader } from "./model-images.ts"

let dir: string
before(() => {
  dir = mkdtempSync(join(tmpdir(), "viral-model-images-"))
  // a contact-sheet-sized PNG (noise, so it's big) and a small frame
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "nullsrc=s=2400x1340,geq=random(1)*255:128:128", "-frames:v", "1", join(dir, "sheet.png")])
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=s=320x180", "-frames:v", "1", join(dir, "frame.jpg")])
  writeFileSync(join(dir, "notes.txt"), "not an image")
})
after(() => rmSync(dir, { recursive: true, force: true }))

const width = (bytes: Uint8Array) => {
  const file = join(dir, "probe.jpg")
  writeFileSync(file, bytes)
  return Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width", "-of", "csv=p=0", file]).toString().trim())
}

test("big images go to models scaled down as JPEGs (kept for next time); small ones and their own type as they are", async () => {
  const cache = join(dir, "cache")
  const read = (file: string) => Effect.runPromise(modelImageReader(cache).pipe(Effect.flatMap((r) => r(file)), Effect.provide(NodeServices.layer)))
  assert.ok(statSync(join(dir, "sheet.png")).size > 500_000, "the sheet is big")

  const sheet = Option.getOrThrow(await read(join(dir, "sheet.png")))
  assert.equal(sheet.file, join(dir, "sheet.png"), "the model is told the original file")
  assert.equal(sheet.mediaType, "image/jpeg")
  assert.equal(width(sheet.bytes), MAX_EDGE)
  assert.ok(sheet.bytes.byteLength < statSync(join(dir, "sheet.png")).size)
  assert.equal(readdirSync(cache).filter((f) => f.endsWith(".jpg") && !f.startsWith(".")).length, 1)
  const again = Option.getOrThrow(await read(join(dir, "sheet.png")))
  assert.deepEqual(again.bytes, sheet.bytes, "the scaled copy is reused")

  const frame = Option.getOrThrow(await read(join(dir, "frame.jpg")))
  assert.equal(frame.mediaType, "image/jpeg")
  assert.equal(frame.bytes.byteLength, statSync(join(dir, "frame.jpg")).size, "sent as it is")
  assert.ok(Option.isNone(await read(join(dir, "notes.txt"))))
  assert.ok(Option.isNone(await read(join(dir, "missing.png"))))
})
