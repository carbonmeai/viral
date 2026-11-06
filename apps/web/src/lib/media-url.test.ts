import assert from "node:assert/strict"
import { test } from "node:test"
import { artifactFileUrl, artifactPathUrl } from "./media-url.ts"

test("media urls point inside the owner's artifact folder", () => {
  assert.equal(
    artifactFileUrl("http://127.0.0.1:3410", { _tag: "Project", id: "p1" }, "shot-plan", 2, "frames/shot-01.jpg"),
    "http://127.0.0.1:3410/media/projects/p1/shot-plan/v2/frames/shot-01.jpg"
  )
  assert.equal(
    artifactPathUrl("http://x", { _tag: "Source", id: "s 1" }, "contact-sheet/v1/frames/frame_00000.jpg"),
    "http://x/media/sources/s%201/contact-sheet/v1/frames/frame_00000.jpg"
  )
})
