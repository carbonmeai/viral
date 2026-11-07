import assert from "node:assert/strict"
import { test } from "node:test"
import { metadataTask } from "./metadata-task.ts"

const input = { title: "Candy", channel: "NileBlue", summary: "He tries the candy.", approach: "claim-interleaved", durationS: 50, workingTitle: "W", lines: "NARRATOR: hi" }

test("one video: the video and what happens in it", () => {
  const { brief } = metadataTask(input)
  assert.match(brief, /Video: Candy \(by NileBlue\)\n\nWhat happens: He tries the candy\./)
})

test("several videos: each one labelled with what it brings, and what joins them", () => {
  const { brief } = metadataTask({
    ...input,
    videos: [
      { title: "Candy", channel: "NileBlue", seconds: 600, summary: "He tries the candy." },
      { title: "Acid", channel: "ChemLab", seconds: 0, summary: null }
    ],
    acrossVideos: "The candy, then why it hurts."
  })
  assert.match(brief, /The short draws from 2 videos:\n- V1 "Candy" \(NileBlue, 10:00\): He tries the candy\.\n- V2 "Acid" \(ChemLab\)/)
  assert.match(brief, /What joins them: The candy, then why it hurts\./)
  assert.doesNotMatch(brief, /^Video: /m)
})
