import { NodeServices } from "@effect/platform-node"
import type { ToolProgress } from "@viral/contracts"
import { ConfigProvider, Duration, Effect, Layer, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import type { ToolSpec } from "./tool-specs.ts"
import { prependToolsPath, Tools, type ToolsOptions } from "./tools.ts"

let root: string
let server: Server
let base: string
// every path the fake download server was asked for
const requested: Array<string> = []
const files = new Map<string, Buffer>()

// A fake tool: a shell script that prints its version, and records a self-update when given -U.
const script = (name: string, version: string) =>
  Buffer.from(`#!/bin/sh\nif [ "$1" = "-U" ]; then echo updated >> "$(dirname "$0")/${name}.updated"; exit 0; fi\necho "${name} version ${version}"\n`)
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")

before(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "viral-tools-")))
  files.set("/ffmpeg", script("ffmpeg", "6.1.1"))
  files.set("/ffprobe", script("ffprobe", "6.1.1"))
  files.set("/yt-dlp", script("yt-dlp", "2026.10.26"))
  // uv ships as a .tar.gz with the binary inside a folder
  const staging = join(root, "uv-staging", "uv-pkg")
  mkdirSync(staging, { recursive: true })
  writeFileSync(join(staging, "uv"), script("uv", "0.13.7"), { mode: 0o755 })
  execFileSync("tar", ["-czf", join(root, "uv.tar.gz"), "-C", join(root, "uv-staging"), "uv-pkg/uv"])
  files.set("/uv.tar.gz", readFileSync(join(root, "uv.tar.gz")))

  server = createServer((req, res) => {
    requested.push(req.url ?? "")
    const body = files.get(req.url ?? "")
    if (body === undefined) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { "content-length": String(body.length) }).end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(() => {
  server.close()
  rmSync(root, { recursive: true, force: true })
})

const specs = (): Array<ToolSpec> => [
  // no published checksum: trusted on first download and recorded
  { name: "ffmpeg", url: `${base}/ffmpeg`, sha256: null },
  { name: "ffprobe", url: `${base}/ffprobe`, sha256: sha(files.get("/ffprobe")!) },
  { name: "uv", url: `${base}/uv.tar.gz`, sha256: sha(files.get("/uv.tar.gz")!), archive: { member: "uv-pkg/uv" } },
  { name: "yt-dlp", url: `${base}/yt-dlp`, sha256: sha(files.get("/yt-dlp")!) }
]

const fresh = (name: string) => {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

const run = <A>(options: ToolsOptions, use: (tools: Tools["Service"]) => Effect.Effect<A>) =>
  Effect.runPromise(Tools.make(options).pipe(Effect.flatMap(use), Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer))))

const installAll = (tools: Tools["Service"]) => tools.install.pipe(Stream.runCollect, Effect.map((chunk) => [...chunk] as Array<ToolProgress>))

test("a fresh install downloads every missing tool, verifies it and makes it runnable", async () => {
  const dir = join(fresh("fresh"), "tools")
  const options = { dir, path: fresh("fresh-path"), specs: specs(), updateEvery: Duration.days(3) }
  const events = await run(options, installAll)

  const installed = events.filter((e) => e._tag === "Installed").map((e) => e._tag === "Installed" ? e.tool : null)
  assert.deepEqual(installed.map((t) => t?.name).sort(), ["ffmpeg", "ffprobe", "uv", "yt-dlp"])
  for (const tool of installed) {
    assert.equal(tool?.status, "ready")
    assert.equal(tool?.source, "viral")
    assert.match(tool?.version ?? "", new RegExp(`^${tool?.name} version`))
    assert.ok((statSync(join(dir, tool!.name)).mode & 0o111) !== 0, `${tool?.name} is executable`)
  }
  assert.ok(events.some((e) => e._tag === "Downloading" && e.total !== null), "progress reports the size")
  // ffmpeg had no published checksum: the first download's is recorded for next time
  const lock = JSON.parse(readFileSync(join(dir, "tools.lock.json"), "utf8"))
  assert.equal(lock.ffmpeg.sha256, sha(files.get("/ffmpeg")!))
  assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith(".")), [], "no temporary files are left")

  // a second install has nothing to do
  assert.deepEqual(await run(options, installAll), [])
})

test("a download whose checksum doesn't match is refused and leaves the folder clean", async () => {
  const dir = fresh("mismatch")
  const bad = specs().map((s) => s.name === "yt-dlp" ? { ...s, sha256: "0".repeat(64) } : s).filter((s) => s.name === "yt-dlp")
  const options = { dir, path: fresh("mismatch-path"), specs: bad, updateEvery: Duration.days(3) }
  const [events, listed] = await run(options, (tools) => Effect.all([installAll(tools), tools.list]))

  const failed = events.find((e) => e._tag === "Failed" && e.name === "yt-dlp")
  assert.ok(failed?._tag === "Failed" && /doesn't match the pinned/.test(failed.message))
  assert.equal(existsSync(join(dir, "yt-dlp")), false)
  assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith(".")), [], "no temporary files are left")
  assert.equal(listed.find((t) => t.name === "yt-dlp")?.status, "failed")
})

test("tools already on the PATH are used as they are and never downloaded", async () => {
  const system = fresh("system-bin")
  writeFileSync(join(system, "ffmpeg"), script("ffmpeg", "7.0-homebrew"), { mode: 0o755 })
  const dir = fresh("system-tools")
  requested.length = 0
  const options = { dir, path: `${fresh("empty")}:${system}`, specs: specs(), updateEvery: Duration.days(3) }
  const [events, listed] = await run(options, (tools) => Effect.all([installAll(tools), tools.list]))

  assert.equal(requested.includes("/ffmpeg"), false, "ffmpeg wasn't downloaded")
  assert.equal(events.some((e) => e._tag === "Installed" && e.tool.name === "ffmpeg"), false)
  const ffmpeg = listed.find((t) => t.name === "ffmpeg")
  assert.equal(ffmpeg?.source, "system")
  assert.equal(ffmpeg?.path, join(system, "ffmpeg"))
  assert.equal(ffmpeg?.version, "ffmpeg version 7.0-homebrew")
})

test("Viral's own copy wins over the PATH, and the server puts its folder first", async () => {
  const system = fresh("order-system")
  const dir = fresh("order-tools")
  writeFileSync(join(system, "uv"), script("uv", "system"), { mode: 0o755 })
  writeFileSync(join(dir, "uv"), script("uv", "viral"), { mode: 0o755 })
  const listed = await run({ dir, path: system, specs: [], updateEvery: Duration.days(3) }, (tools) => tools.list)
  const uv = listed.find((t) => t.name === "uv")
  assert.equal(uv?.source, "viral")
  assert.equal(uv?.version, "uv version viral")
  assert.equal(listed.find((t) => t.name === "ffprobe")?.status, "missing")

  const saved = process.env["PATH"]
  try {
    const prepend = prependToolsPath.pipe(
      Effect.provide(Layer.mergeAll(NodeServices.layer, ConfigProvider.layer(ConfigProvider.fromUnknown({ VIRAL_TOOLS_DIR: dir, PATH: "/usr/bin:/bin" }))))
    )
    await Effect.runPromise(prepend)
    assert.equal(process.env["PATH"], `${dir}:/usr/bin:/bin`)
    // a started tool finds Viral's copy by name
    assert.equal(execFileSync("uv", ["--version"], { env: process.env }).toString().trim(), "uv version viral")
  } finally {
    process.env["PATH"] = saved
  }
})

test("Viral's yt-dlp updates itself at most once per interval; a PATH copy never does", async () => {
  const dir = fresh("update-tools")
  writeFileSync(join(dir, "yt-dlp"), script("yt-dlp", "old"), { mode: 0o755 })
  const options = { dir, path: "", specs: [], updateEvery: Duration.days(3) }
  const first = await run(options, (tools) => tools.updateYtDlp)
  const second = await run(options, (tools) => tools.updateYtDlp)
  assert.deepEqual([first, second], ["updated", "skipped"])
  assert.equal(readFileSync(join(dir, "yt-dlp.updated"), "utf8").trim().split("\n").length, 1, "yt-dlp -U ran once")
  assert.equal(await run({ ...options, updateEvery: Duration.zero }, (tools) => tools.updateYtDlp), "updated", "due again once the interval passes")

  const systemOnly = fresh("update-system")
  writeFileSync(join(systemOnly, "yt-dlp"), script("yt-dlp", "brew"), { mode: 0o755 })
  chmodSync(join(systemOnly, "yt-dlp"), 0o755)
  const skipped = await run({ dir: fresh("update-empty"), path: systemOnly, specs: [], updateEvery: Duration.zero }, (tools) => tools.updateYtDlp)
  assert.equal(skipped, "skipped")
  assert.equal(existsSync(join(systemOnly, "yt-dlp.updated")), false)
})
