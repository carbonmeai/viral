// A video found by research is downloaded as a 480p scan, and a short fetches only the seconds it plays in full
// quality: against the fake yt-dlp (a small blue scan, larger green pieces, a sound that follows the video's clock).
import type { SourceOrigin } from "@viral/contracts"
import { Effect, Exit, Layer, ManagedRuntime } from "effect"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Artifacts } from "../artifacts/artifacts.ts"
import { FAKE_YT_DLP } from "../research/testing/fake-youtube.ts"
import { SourceFetcher } from "./source-fetcher.ts"
import { SourcePieces } from "./source-pieces.ts"
import { Sources } from "./sources.ts"

let home: string
let log: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-pieces-"))
  log = join(home, "yt-dlp.log")
  process.env["VIRAL_HOME"] = home
  process.env["VIRAL_YT_DLP"] = FAKE_YT_DLP
  process.env["VIRAL_YT_RETRY_PAUSE_S"] = "0"
  process.env["FAKE_YT_LOG"] = log
  process.env["FAKE_YT_DURATION"] = "120"
})
after(() => {
  for (const name of ["VIRAL_YT_DLP", "VIRAL_YT_RETRY_PAUSE_S", "FAKE_YT_LOG", "FAKE_YT_SECTIONS_403", "FAKE_YT_DOWNLOAD_ERRORS", "FAKE_YT_DURATION"]) delete process.env[name]
  rmSync(home, { recursive: true, force: true })
})

// a video the fake doesn't know from the search log: 2 minutes long (FAKE_YT_DURATION)
const HORSE = "https://www.youtube.com/watch?v=fakeHorse01"

const runtime = () => ManagedRuntime.make(Layer.mergeAll(Sources.layer, Artifacts.layer, SourceFetcher.layer, SourcePieces.layer))

// yt-dlp's calls so far, each its arguments
const calls = (): ReadonlyArray<ReadonlyArray<string>> =>
  existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Array<string>) : []
const sectionsOf = (args: ReadonlyArray<string>) => args.flatMap((a, i) => args[i - 1] === "--download-sections" ? [a] : [])

// Fetches a source the way the source stage does and records its video.
const fetchSource = (origin: SourceOrigin) =>
  Effect.gen(function*() {
    const sources = yield* Sources
    const artifacts = yield* Artifacts
    const source = yield* sources.create({ origin, rights: "unconfirmed", rightsNote: null })
    const owner = { _tag: "Source", id: source.id } as const
    const slot = yield* artifacts.allocate(owner, "source-video")
    const fetched = yield* (yield* SourceFetcher).fetch(origin, slot.dir, () => Effect.void)
    yield* sources.recordMetadata(source.id, { title: fetched.title, channel: fetched.channel, url: fetched.url, durationS: fetched.duration_s })
    yield* artifacts.record(slot, { data: fetched, path: join(slot.relDir, fetched.path) })
    return { source: yield* sources.get(source.id), fetched, file: join(slot.dir, fetched.path) }
  })

test("a found video is downloaded as a 480p scan, and a short fetches only its stretches in 1080p, once", async () => {
  const rt = runtime()
  const { source, fetched, file } = await rt.runPromise(fetchSource({ _tag: "Url", url: HORSE, scan: true }))
  assert.equal(fetched.scan, true)
  assert.equal(fetched.height, 72, "the fake's scan")
  assert.ok(existsSync(file))
  const scanCall = calls().at(-1)!
  assert.match(scanCall[scanCall.indexOf("-f") + 1]!, /^bv\*\[height=480\]/, "asked for 480p first")
  assert.ok(!scanCall.includes("--download-sections"))

  // three shots, two of them close together: one request, two pieces (a second of padding either side)
  const pieces = (ranges: ReadonlyArray<{ start: number; end: number }>) =>
    rt.runPromise(SourcePieces.use((p) => p.forSource(source, ranges, () => Effect.void)))
  const first = await pieces([{ start: 10, end: 13 }, { start: 40, end: 44 }, { start: 12, end: 15 }])
  assert.equal(first.scan, true)
  assert.equal(first.problem, null)
  assert.equal(first.height, 180, "the fake's pieces")
  assert.equal(first.scanHeight, 72)
  assert.deepEqual(first.pieces.map((p) => [p.start, p.end]), [[9, 16], [39, 45]])
  for (const p of first.pieces) assert.ok(existsSync(p.path), `${p.path} is on disk`)
  const fetches = calls().filter((c) => c.includes("--download-sections"))
  assert.equal(fetches.length, 1, "one request for the whole video")
  assert.deepEqual(sectionsOf(fetches[0]!), ["*9-16", "*39-45"])
  assert.match(fetches[0]![fetches[0]!.indexOf("-f") + 1]!, /^bv\*\[height=1080\]/, "pieces are 1080p")
  // each piece's sound was matched against the scan's: the fake's pieces start where they were asked to
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", first.pieces[0]!.path]))
  assert.ok(Math.abs(seconds - 7) < 0.2, `the first piece is ${seconds}s`)

  // a stretch inside what's there: nothing fetched; a new one: only it
  const again = await pieces([{ start: 11, end: 12 }])
  assert.deepEqual(again.pieces.map((p) => [p.start, p.end]), [[9, 16]])
  assert.equal(calls().filter((c) => c.includes("--download-sections")).length, 1, "reused, not fetched again")
  const more = await pieces([{ start: 80, end: 82 }, { start: 41, end: 43 }])
  const fetchedNow = calls().filter((c) => c.includes("--download-sections"))
  assert.equal(fetchedNow.length, 2)
  assert.deepEqual(sectionsOf(fetchedNow[1]!), ["*79-83"], "only the stretch no piece covers")
  assert.deepEqual(more.pieces.map((p) => [p.start, p.end]), [[39, 45], [79, 83]])
  const index = JSON.parse(readFileSync(join(home, "sources", source.id, "pieces", "pieces.json"), "utf8")) as { pieces: ReadonlyArray<{ file: string }> }
  assert.deepEqual(index.pieces.map((p) => p.file), ["9-16.mp4", "39-45.mp4", "79-83.mp4"])

  // a 403 is retried once…
  process.env["FAKE_YT_SECTIONS_403"] = String(calls().filter((c) => c.includes("--download-sections")).length + 1)
  const retried = await pieces([{ start: 100, end: 101 }])
  assert.equal(retried.problem, null)
  assert.deepEqual(retried.pieces.map((p) => [p.start, p.end]), [[99, 102]])
  // …a second one is a plain problem, and the render plays from the scan (no piece for it); pieces already there still count
  process.env["FAKE_YT_SECTIONS_403"] = "1000"
  const blocked = await pieces([{ start: 110, end: 112 }, { start: 10, end: 12 }])
  assert.equal(blocked.problem, "YouTube refused the 1080p pieces twice (403)")
  assert.deepEqual(blocked.pieces.map((p) => [p.start, p.end]), [[9, 16]])
  delete process.env["FAKE_YT_SECTIONS_403"]
  await rt.dispose()
})

// Your own links download in full through the same yt-dlp (Viral's own; the uv environment's copy can't solve YouTube's
// JavaScript challenge), at 1080p first, with the same one retry for a 403 or a dropped connection, and never a third.
test("your own link downloads in full through Viral's own yt-dlp, retrying a 403 or a dropped connection once", async () => {
  const rt = runtime()
  const own = "https://www.youtube.com/watch?v=fakeOwnLink"
  let attempts: ReadonlyArray<ReadonlyArray<string>> = []
  // a fresh log per case, so the fake counts this case's attempts
  const attempt = async (errors: string) => {
    process.env["FAKE_YT_LOG"] = join(home, `own-${errors || "ok"}.log`)
    process.env["FAKE_YT_DOWNLOAD_ERRORS"] = errors
    try {
      return await rt.runPromiseExit(fetchSource({ _tag: "Url", url: own }))
    } finally {
      const tried = readFileSync(process.env["FAKE_YT_LOG"], "utf8").trim().split("\n").map((l) => JSON.parse(l) as Array<string>)
      process.env["FAKE_YT_LOG"] = log
      delete process.env["FAKE_YT_DOWNLOAD_ERRORS"]
      attempts = tried
    }
  }

  const ok = await attempt("")
  assert.ok(Exit.isSuccess(ok), String(Exit.isFailure(ok) ? ok.cause : ""))
  assert.equal(ok.value.fetched.scan, undefined, "a full download, not a scan")
  assert.equal(ok.value.fetched.channel, "Fake Channel")
  assert.ok(existsSync(ok.value.file))
  assert.equal(attempts.length, 1)
  assert.match(attempts[0]![attempts[0]!.indexOf("-f") + 1]!, /^bv\*\[height=1080\]/, "asked for 1080p first")
  assert.ok(!attempts[0]!.includes("--download-sections"))

  for (const errors of ["403", "reset"]) {
    const retried = await attempt(errors)
    assert.ok(Exit.isSuccess(retried), `${errors} once is retried: ${Exit.isFailure(retried) ? retried.cause : ""}`)
    assert.equal(attempts.length, 2)
  }

  const blocked = await attempt("403,403,403")
  assert.ok(Exit.isFailure(blocked))
  assert.match(String(blocked.cause), /refused the download twice \(403\)/)
  assert.equal(attempts.length, 2, "never a third try")
  await rt.dispose()
})

test("a full download, or your own file, fetches nothing", async () => {
  const rt = runtime()
  const video = join(home, "own.mp4")
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=160x90:d=5:r=10", "-c:v", "libx264", "-pix_fmt", "yuv420p", video])
  const own = await rt.runPromise(fetchSource({ _tag: "File", path: video }))
  assert.equal(own.fetched.scan, undefined)
  const before = calls().length
  const footage = await rt.runPromise(SourcePieces.use((p) => p.forSource(own.source, [{ start: 1, end: 2 }], () => Effect.void)))
  assert.deepEqual(footage, { scan: false, pieces: [], height: null, scanHeight: null, problem: null })
  assert.equal(calls().length, before, "no yt-dlp call")
  await rt.dispose()
})
