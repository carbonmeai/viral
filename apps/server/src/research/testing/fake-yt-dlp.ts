#!/usr/bin/env node
// A fake yt-dlp for the research tests: answers `--flat-playlist ytsearch8:<query>` from the rescues search log
// (rescues-search.txt, the skill run's real results), and a lookup of one video with its details and, when asked,
// an English caption file. With `-f` it downloads: a scan (`-o …/source.%(ext)s`) is a small blue video, each
// `--download-sections "*a-b"` piece a larger green one, both made with ffmpeg, with a sound that follows the video's
// own clock (so a piece's sound matches the scan's at the same second). No network. Environment:
//   FAKE_YT_LOG          append each call's arguments here (one JSON line per call)
//   FAKE_YT_BLOCK        "all", or video ids / "search", answered with a 403
//   FAKE_YT_UNAVAILABLE  video ids that are removed ("Video unavailable")
//   FAKE_YT_LIVE         video ids that are live streams
//   FAKE_YT_SECTIONS_403 refuse this many piece downloads (counted in FAKE_YT_LOG) with a 403
//   FAKE_YT_DURATION     the length of a downloaded video not in the search log (default 60 s)
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

const args = process.argv.slice(2)
const env = (name: string) => (process.env[name] ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "")
if (process.env["FAKE_YT_LOG"]) appendFileSync(process.env["FAKE_YT_LOG"], `${JSON.stringify(args)}\n`)

interface Video { id: string; duration: number; views: number; channel: string; title: string }
const seconds = (text: string) => text.split(":").map(Number).reduce((t, n) => t * 60 + n, 0)
const searches = new Map<string, Array<Video>>()
let current: Array<Video> = []
for (const line of readFileSync(join(import.meta.dirname, "rescues-search.txt"), "utf8").split("\n")) {
  if (line.startsWith("=== ")) {
    current = []
    searches.set(line.slice(4).trim().toLowerCase(), current)
  } else if (line.includes(" | ")) {
    const [id, length, views, channel, ...title] = line.split(" | ")
    current.push({ id: id!.trim(), duration: seconds(length!.trim()), views: Number(views), channel: channel!.trim(), title: title.join(" | ").trim() })
  }
}
const all = new Map([...searches.values()].flat().map((v) => [v.id, v]))
const live = new Set(env("FAKE_YT_LIVE"))
const blocked = (what: string) => env("FAKE_YT_BLOCK").includes("all") || env("FAKE_YT_BLOCK").includes(what)
const fail = (message: string) => {
  process.stderr.write(`ERROR: ${message}\n`)
  process.exit(1)
}
const entry = (v: Video) => ({
  _type: "url",
  id: v.id,
  url: `https://www.youtube.com/watch?v=${v.id}`,
  title: v.title,
  channel: v.channel,
  duration: live.has(v.id) ? null : v.duration,
  view_count: v.views,
  live_status: live.has(v.id) ? "is_live" : null
})

const search = args.find((a) => a.startsWith("ytsearch"))
if (search !== undefined) {
  const query = search.replace(/^ytsearch\d*:/, "").trim().toLowerCase()
  if (blocked("search")) fail(`[youtube:search] ${query}: HTTP Error 403: Forbidden`)
  const results = searches.get(query) ?? []
  process.stdout.write(JSON.stringify({ id: query, title: query, _type: "playlist", entries: results.map(entry) }))
  process.exit(0)
}

const url = args.at(-1) ?? ""
const id = /v=([\w-]{11})/.exec(url)?.[1] ?? url
if (blocked(id)) fail(`[youtube] ${id}: HTTP Error 403: Forbidden`)
if (env("FAKE_YT_UNAVAILABLE").includes(id)) fail(`[youtube] ${id}: Video unavailable. This video has been removed by the uploader`)

// a download: the scan, or the pieces asked for
const value = (flag: string) => args[args.indexOf(flag) + 1]
if (args.includes("-f")) {
  const duration = all.get(id)?.duration ?? Number(process.env["FAKE_YT_DURATION"] ?? 60)
  const sections = args.flatMap((a, i) => args[i - 1] === "--download-sections" ? [a] : [])
  // a sound that follows the video's clock, so any stretch of it can be matched to the same stretch of the scan
  const sound = (from: number, seconds: number) =>
    `aevalsrc=exprs='0.3*sin(2*PI*(300+200*sin(0.37*(t+${from})))*(t+${from}))':s=44100:d=${seconds}`
  const make = (file: string, color: string, size: string, from: number, seconds: number) =>
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:s=${size}:r=10:d=${seconds}`,
      "-f", "lavfi", "-i", sound(from, seconds), "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", file])
  const template = value("-o") ?? "%(id)s.%(ext)s"
  if (sections.length === 0) {
    const file = template.replace("%(ext)s", "mp4")
    make(file, "0x2050FF", "128x72", 0, duration)
    process.stdout.write(`${JSON.stringify({ title: all.get(id)?.title ?? id, channel: all.get(id)?.channel ?? "Fake Channel", uploader: null, webpage_url: url })}\n`)
    process.exit(0)
  }
  const log = process.env["FAKE_YT_LOG"]
  const asked = log !== undefined && existsSync(log)
    ? readFileSync(log, "utf8").split("\n").filter((l) => l.includes("--download-sections")).length
    : 0
  if (asked <= Number(process.env["FAKE_YT_SECTIONS_403"] ?? 0)) fail(`[download] Got error: HTTP Error 403: Forbidden`)
  for (const section of sections) {
    const [a, b] = section.replace(/^\*/, "").split("-").map(Number) as [number, number]
    const end = Math.min(b, duration)
    const file = template.replace("%(section_start)s", String(a)).replace("%(section_end)s", String(b)).replace("%(ext)s", "mp4")
    make(file, "green", "320x180", a, end - a)
    process.stdout.write(`${JSON.stringify({ filepath: file, section_start: a, section_end: b, width: 320, height: 180 })}\n`)
  }
  process.exit(0)
}

const video = all.get(id)
if (video === undefined) fail(`[youtube] ${id}: Video unavailable`)
const v = video!
const out = args[args.indexOf("-o") + 1]
if (args.includes("--write-auto-subs") && out !== undefined && args.indexOf("-o") >= 0) {
  const file = join(dirname(out), `${id}.en.vtt`)
  writeFileSync(file, [
    "WEBVTT", "Kind: captions", "Language: en", "",
    "00:00:01.000 --> 00:00:04.000", `We found ${v.title.split(" ").slice(0, 3).join(" ")} by the road.`, "",
    "00:00:04.000 --> 00:00:04.010", `We found ${v.title.split(" ").slice(0, 3).join(" ")} by the road.`, "",
    "00:00:30.000 --> 00:00:33.000", "At the vet she got fluids and a bath.", "",
    "00:01:30.000 --> 00:01:33.000", "Six weeks later she runs to the door.", ""
  ].join("\n"))
}
process.stdout.write(JSON.stringify({
  ...entry(v),
  _type: "video",
  description: `${v.title}. Before, the vet and after.`,
  upload_date: "20260207",
  is_live: live.has(id),
  chapters: [{ start_time: 0, title: "The rescue" }, { start_time: 30, title: "At the vet" }, { start_time: 90, title: "After" }]
}))
