import assert from "node:assert/strict"
import { test } from "node:test"
import { AUDIO_EXTENSIONS, openFileDialog, VIDEO_EXTENSIONS } from "./open-file-kinds.ts"

test("the open panel offers videos by default and audio for the music library", () => {
  assert.deepEqual(openFileDialog(undefined).extensions, VIDEO_EXTENSIONS)
  assert.deepEqual(openFileDialog("video").extensions, VIDEO_EXTENSIONS)
  assert.deepEqual(openFileDialog("audio").extensions, AUDIO_EXTENSIONS)
  assert.equal(openFileDialog("audio").title, "Choose a music track")
  assert.equal(openFileDialog("anything else").name, "Videos", "unexpected input is treated as a video")
})
