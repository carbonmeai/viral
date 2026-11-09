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

const scanFormat = execFileSync("python3", [join(import.meta.dirname, "fetch-source.py"), "--print-scan-format"]).toString().trim()

test("a scan (a video found by research) prefers 480p, then less, and only then up to 720p", () => {
  const choices = scanFormat.split("/")
  assert.equal(choices[0], "bv*[height=480][vcodec^=avc1]+ba[ext=m4a]", "480p H.264 + AAC first, so the mp4 merge copies")
  const at = (pattern: RegExp) => choices.findIndex((c) => pattern.test(c))
  assert.ok(at(/height<=480/) < at(/height<=720/), "anything under 480p before 720p")
  for (const choice of choices.slice(0, -1)) assert.match(choice, /height(=|<=)(480|720)/, `${choice} is capped`)
})

// Runs download_with_retry (youtube_download.py, shared by fetch-source.py and fetch-pieces.py) with a fake download that
// fails the given way `fails` times.
const retry = (error: string, fails: number) => {
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("youtube_download", ${JSON.stringify(join(import.meta.dirname, "youtube_download.py"))})
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
calls, pauses = [], []
def download():
    calls.append(1)
    if len(calls) <= ${fails}: raise Exception(${JSON.stringify(error)})
    return {"title": "ok"}
try:
    info = m.download_with_retry(download, pauses.append)
    print(json.dumps({"result": info["title"], "calls": len(calls), "pauses": pauses}))
except m.FetchFailure as f:
    print(json.dumps({"code": f.code, "message": str(f), "calls": len(calls), "pauses": pauses}))
`
  const lines = execFileSync("python3", ["-c", script]).toString().trim().split("\n")
  return JSON.parse(lines.at(-1)!) as { result?: string; code?: string; message?: string; calls: number; pauses: ReadonlyArray<number> }
}

test("a 403 or a dropped connection is retried once after a pause, a second 403 is reported as blocked, other failures aren't retried", () => {
  const once = retry("ERROR: unable to download video data: HTTP Error 403: Forbidden", 1)
  assert.equal(once.result, "ok")
  assert.equal(once.calls, 2)
  assert.equal(once.pauses.length, 1)

  const twice = retry("ERROR: unable to download video data: HTTP Error 403: Forbidden", 2)
  assert.equal(twice.code, "blocked")
  assert.equal(twice.calls, 2, "never a third try")
  assert.match(twice.message!, /doesn't work around a block/)

  const dropped = retry("ERROR: [download] 12-20: ffmpeg exited with code 8 (Connection reset by peer)", 1)
  assert.equal(dropped.result, "ok", "a dropped connection gets one more try too")
  assert.equal(dropped.calls, 2)

  const gone = retry("ERROR: [youtube] abc: Video unavailable", 1)
  assert.equal(gone.code, "download")
  assert.equal(gone.calls, 1)
  assert.equal(gone.pauses.length, 0)
})
