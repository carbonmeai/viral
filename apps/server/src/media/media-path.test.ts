import assert from "node:assert/strict"
import { test } from "node:test"
import { appOrigin, byteRange, mediaSegments } from "./media-path.ts"

test("only files inside the media folders are allowed", () => {
  assert.deepEqual(mediaSegments("projects/p1/shot-plan/v2/frames/shot-01.jpg"), ["projects", "p1", "shot-plan", "v2", "frames", "shot-01.jpg"])
  assert.deepEqual(mediaSegments("renders/02-candy.mp4"), ["renders", "02-candy.mp4"])
  for (const bad of ["", "viral.db", "/etc/passwd", "projects/../viral.db", "projects/./x", "projects//x", "projects\\x", "projects/x\0", "secrets/k", "projects"]) {
    assert.equal(mediaSegments(bad), null, bad)
  }
})

test("byte ranges for seeking", () => {
  assert.deepEqual(byteRange("bytes=0-99", 1000), { _tag: "Range", start: 0, length: 100, contentRange: "bytes 0-99/1000" })
  assert.deepEqual(byteRange("bytes=900-", 1000), { _tag: "Range", start: 900, length: 100, contentRange: "bytes 900-999/1000" })
  assert.deepEqual(byteRange("bytes=-100", 1000), { _tag: "Range", start: 900, length: 100, contentRange: "bytes 900-999/1000" })
  assert.deepEqual(byteRange("bytes=0-5000", 1000), { _tag: "Range", start: 0, length: 1000, contentRange: "bytes 0-999/1000" })
  assert.equal(byteRange("bytes=1000-", 1000)?._tag, "Unsatisfiable")
  assert.equal(byteRange("bytes=5-1", 1000), null)
  assert.equal(byteRange("items=0-1", 1000), null)
  assert.equal(byteRange("bytes=0-1,5-9", 1000), null)
})

test("only Viral's own UI may read media cross-origin", () => {
  assert.equal(appOrigin("viral://app"), "viral://app")
  assert.equal(appOrigin("http://127.0.0.1:5733"), "http://127.0.0.1:5733")
  assert.equal(appOrigin("http://localhost:5762"), "http://localhost:5762")
  assert.equal(appOrigin("https://evil.example"), null)
  assert.equal(appOrigin("http://127.0.0.1.evil.example"), null)
  assert.equal(appOrigin(undefined), null)
})
