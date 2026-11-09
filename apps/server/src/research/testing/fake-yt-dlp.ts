#!/usr/bin/env node
// A fake yt-dlp for the research tests: answers `--flat-playlist ytsearch8:<query>` from the rescues search log
// (rescues-search.txt, the skill run's real results), and a lookup of one video with its details and, when asked,
// an English caption file. No network. Environment:
//   FAKE_YT_LOG          append each call's arguments here (one JSON line per call)
//   FAKE_YT_BLOCK        "all", or video ids / "search", answered with a 403
//   FAKE_YT_UNAVAILABLE  video ids that are removed ("Video unavailable")
//   FAKE_YT_LIVE         video ids that are live streams
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
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
