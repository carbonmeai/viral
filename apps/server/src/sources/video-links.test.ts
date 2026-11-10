import { NodeServices } from "@effect/platform-node"
import { Effect, Layer, ManagedRuntime } from "effect"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { ViralHome } from "../home/viral-home.ts"
import { FAKE_YT_DLP } from "../research/testing/fake-youtube.ts"
import { YouTube } from "../research/youtube.ts"
import { VideoLinks } from "./video-links.ts"

let home: string
let log: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-links-"))
  log = join(home, "yt.log")
  process.env["VIRAL_HOME"] = home
  process.env["FAKE_YT_LOG"] = log
  process.env["FAKE_YT_BLOCK"] = "A3qhJbqA--k"
  process.env["FAKE_YT_UNAVAILABLE"] = "kxPGFEuhT4o"
})
after(() => {
  for (const name of ["FAKE_YT_LOG", "FAKE_YT_BLOCK", "FAKE_YT_UNAVAILABLE"]) delete process.env[name]
  rmSync(home, { recursive: true, force: true })
})

// The fake yt-dlp answers from the rescues search log; a thumbnail is "fetched" by writing a file.
const fetched: Array<string> = []
const runtime = () =>
  ManagedRuntime.make(
    Layer.effect(VideoLinks, VideoLinks.make).pipe(
      Layer.provide([
        YouTube.layerWith({
          command: FAKE_YT_DLP,
          spacing: 0,
          fetchThumbnail: (videoId, file) => Effect.sync(() => (fetched.push(videoId), writeFileSync(file, "jpg"), true))
        }),
        ViralHome.layer,
        NodeServices.layer
      ])
    )
  )
const calls = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter((l) => l !== "").map((l) => JSON.parse(l) as Array<string>) : []

test("a pasted link shows its title, channel, length and thumbnail before anything downloads", async () => {
  const rt = runtime()
  const lookup = (link: string) => rt.runPromise(Effect.gen(function*() {
    return yield* (yield* VideoLinks).lookup(link)
  }))
  const shorts = await lookup(" https://youtube.com/shorts/XMkilsT2Ahs ")
  assert.equal(shorts.url, "https://youtube.com/shorts/XMkilsT2Ahs")
  assert.match(shorts.title, /\S/)
  assert.ok(shorts.channel !== null)
  assert.ok(shorts.durationS !== null && shorts.durationS > 0)
  assert.equal(shorts.thumbnail, "link-previews/XMkilsT2Ahs.jpg")
  assert.ok(existsSync(join(home, "link-previews", "XMkilsT2Ahs.jpg")), "the thumbnail is saved in the Viral home")
  assert.equal(shorts.live, false)

  // yt-dlp only reads the video (the plain watch link), never downloads it
  const first = calls()
  assert.equal(first.length, 1)
  assert.equal(first[0]!.at(-1), "https://www.youtube.com/watch?v=XMkilsT2Ahs")
  assert.ok(first[0]!.includes("--skip-download"))
  assert.ok(!first[0]!.includes("-f"), "no format is downloaded")

  // the same link again comes from memory; a youtu.be link to the same video reuses the saved thumbnail
  await lookup("https://youtube.com/shorts/XMkilsT2Ahs")
  assert.equal(calls().length, 1)
  const short = await lookup("https://youtu.be/XMkilsT2Ahs")
  assert.equal(short.thumbnail, "link-previews/XMkilsT2Ahs.jpg")
  assert.deepEqual(fetched, ["XMkilsT2Ahs"], "fetched once")
  await rt.dispose()
})

test("a removed, blocked or non-video link says why in plain words", async () => {
  const rt = runtime()
  const failure = (link: string) => rt.runPromise(Effect.gen(function*() {
    return yield* (yield* VideoLinks).lookup(link)
  }).pipe(Effect.flip))
  assert.match((await failure("https://www.youtube.com/watch?v=kxPGFEuhT4o")).message, /^That video can't be used: .*removed/)
  assert.match((await failure("https://www.youtube.com/watch?v=A3qhJbqA--k")).message, /^YouTube refused the lookup/)
  assert.equal((await failure("top 5 rescues")).message, "That isn't a link.")
  // a link that isn't YouTube goes to yt-dlp as it is, with no thumbnail of its own
  const before = calls().length
  assert.match((await failure("https://www.tiktok.com/@someone/video/123")).message, /^That video can't be used|^Couldn't read that link/)
  assert.equal(calls().at(-1)!.at(-1), "https://www.tiktok.com/@someone/video/123")
  assert.equal(calls().length, before + 1)
  await rt.dispose()
})
