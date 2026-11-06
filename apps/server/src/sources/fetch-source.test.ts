import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { test } from "node:test"

// The selector runs without yt-dlp installed: --print-format exits before anything is imported.
const format = execFileSync("python3", [join(import.meta.dirname, "fetch-source.py"), "--print-format"]).toString().trim()

test("downloads prefer 1080p, then 720p, never above 1080p", () => {
  const choices = format.split("/")
  assert.match(choices[0]!, /^bv\*\[height=1080\]\[vcodec\^=avc1\]\+ba\[ext=m4a\]$/, "1080p H.264 + AAC first, so the mp4 merge copies")
  const at = (pattern: RegExp) => choices.findIndex((c) => pattern.test(c))
  assert.ok(at(/height=1080/) < at(/height=720/), "1080p before 720p")
  assert.ok(at(/height=720/) < at(/height<=1080/), "720p before anything else under 1080p")
  for (const choice of choices.slice(0, -1)) assert.match(choice, /height(=|<=)(1080|720)/, `${choice} is capped`)
  assert.equal(choices.at(-1), "b", "and anything at all, rather than failing")
})
