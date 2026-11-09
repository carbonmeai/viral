import { SourceId } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { addableVideos, refusalText, rerunStep, typedVideo } from "./add-video-values.ts"

test("only videos the short doesn't have can be added; a link or a full path can be typed", () => {
  const library = [{ source: { id: SourceId.make("a") } }, { source: { id: SourceId.make("b") } }]
  assert.deepEqual(addableVideos(library, [SourceId.make("a")]).map((v) => v.source.id), ["b"])
  assert.deepEqual(typedVideo(" https://youtu.be/x "), { _tag: "Url", url: "https://youtu.be/x" })
  assert.deepEqual(typedVideo("/Users/me/clip.mp4"), { _tag: "File", path: "/Users/me/clip.mp4" })
  assert.equal(typedVideo("clip.mp4"), null)
  assert.equal(rerunStep("cut-down"), "sections")
  assert.equal(rerunStep("narrated"), "script")
})

test("a refusal reads as the server worded it", () => {
  assert.equal(refusalText({ _tag: "ProjectSourceInUse", message: "\"Gum\" can't be removed: the shots use it." }, "x"), "\"Gum\" can't be removed: the shots use it.")
  assert.equal(refusalText(new Error(""), "Couldn't change the videos."), "Couldn't change the videos.")
})
