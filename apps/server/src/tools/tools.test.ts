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
import type { ModelSpec, ToolSpec } from "./tool-specs.ts"
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

// A fake uv: `uv tool install|upgrade` records its arguments and uv's folders in uv.log next to it; an install
// puts a runnable yt-dlp into UV_TOOL_BIN_DIR and marks it as uv-managed under UV_TOOL_DIR.
const fakeUv = Buffer.from(`#!/bin/sh
if [ "$1" = "tool" ]; then
  echo "$2 $3 $4 tools=$UV_TOOL_DIR bin=$UV_TOOL_BIN_DIR python=$UV_PYTHON_INSTALL_DIR" >> "$(dirname "$0")/uv.log"
  if [ "$2" = "install" ]; then
    mkdir -p "$UV_TOOL_DIR/yt-dlp"
    printf '#!/bin/sh\necho "yt-dlp version 2026.11.01"\n' > "$UV_TOOL_BIN_DIR/yt-dlp"
    chmod +x "$UV_TOOL_BIN_DIR/yt-dlp"
  fi
  exit 0
fi
echo "uv version 0.13.7"
`)

before(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "viral-tools-")))
  files.set("/ffmpeg", script("ffmpeg", "6.1.1"))
  files.set("/ffprobe", script("ffprobe", "6.1.1"))
  // uv ships as a .tar.gz with the binary inside a folder
  const staging = join(root, "uv-staging", "uv-pkg")
  mkdirSync(staging, { recursive: true })
  writeFileSync(join(staging, "uv"), fakeUv, { mode: 0o755 })
  execFileSync("tar", ["-czf", join(root, "uv.tar.gz"), "-C", join(root, "uv-staging"), "uv-pkg/uv"])
  files.set("/uv.tar.gz", readFileSync(join(root, "uv.tar.gz")))
  // two fake background-removal models, big enough for several progress steps
  files.set("/isnet-general-use.onnx", Buffer.alloc(1_300_000, 7))
  files.set("/u2net_human_seg.onnx", Buffer.alloc(900_000, 9))

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
  { name: "ffmpeg", via: "download", url: `${base}/ffmpeg`, sha256: null },
  { name: "ffprobe", via: "download", url: `${base}/ffprobe`, sha256: sha(files.get("/ffprobe")!) },
  { name: "uv", via: "download", url: `${base}/uv.tar.gz`, sha256: sha(files.get("/uv.tar.gz")!), archive: { member: "uv-pkg/uv" } },
  // installed by the uv downloaded just before it
  { name: "yt-dlp", via: "uv-tool", package: "yt-dlp" }
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
  // yt-dlp came from uv, with uv's folders inside Viral's
  assert.equal(
    readFileSync(join(dir, "uv.log"), "utf8").trim(),
    `install --force yt-dlp tools=${join(dir, "uv-tools")} bin=${dir} python=${join(dir, "python")}`
  )

  // a second install has nothing to do
  assert.deepEqual(await run(options, installAll), [])
})

test("a download whose checksum doesn't match is refused and leaves the folder clean", async () => {
  const dir = fresh("mismatch")
  const bad = specs().flatMap((s) => s.name === "ffprobe" && s.via === "download" ? [{ ...s, sha256: "0".repeat(64) }] : [])
  const options = { dir, path: fresh("mismatch-path"), specs: bad, updateEvery: Duration.days(3) }
  const [events, listed] = await run(options, (tools) => Effect.all([installAll(tools), tools.list]))

  const failed = events.find((e) => e._tag === "Failed" && e.name === "ffprobe")
  assert.ok(failed?._tag === "Failed" && /doesn't match the pinned/.test(failed.message))
  assert.equal(existsSync(join(dir, "ffprobe")), false)
  assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith(".")), [], "no temporary files are left")
  assert.equal(listed.find((t) => t.name === "ffprobe")?.status, "failed")
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

test("yt-dlp needs uv first, and Viral's uv-managed copy upgrades through uv", async () => {
  const noUv = fresh("uvtool-none")
  const [events] = await run({ dir: noUv, path: "", specs: specs().filter((s) => s.name === "yt-dlp"), updateEvery: Duration.days(3) }, (tools) =>
    Effect.all([installAll(tools)]))
  const failed = events.find((e) => e._tag === "Failed" && e.name === "yt-dlp")
  assert.ok(failed?._tag === "Failed" && /uv isn't installed yet/.test(failed.message))

  const dir = fresh("uvtool")
  writeFileSync(join(dir, "uv"), fakeUv, { mode: 0o755 })
  const options = { dir, path: "", specs: specs().filter((s) => s.name === "yt-dlp"), updateEvery: Duration.zero }
  const [installed, upgraded] = await run(options, (tools) => Effect.all([installAll(tools), tools.updateYtDlp]))
  const tool = installed.find((e) => e._tag === "Installed")
  assert.ok(tool?._tag === "Installed" && tool.tool.source === "viral" && tool.tool.version === "yt-dlp version 2026.11.01")
  assert.equal(upgraded, "updated")
  assert.deepEqual(readFileSync(join(dir, "uv.log"), "utf8").trim().split("\n").map((l) => l.split(" tools=")[0]?.trim()), [
    "install --force yt-dlp",
    "upgrade yt-dlp"
  ])
})

const modelSpecs = (): Array<ModelSpec> => ["isnet-general-use.onnx", "u2net_human_seg.onnx"].map((file) => ({
  file,
  url: `${base}/${file}`,
  sha256: sha(files.get(`/${file}`)!),
  size: files.get(`/${file}`)!.length
}))

test("first-run install never fetches the background-removal models", async () => {
  const dir = fresh("models-not-required")
  requested.length = 0
  const options = { dir, path: "", specs: specs(), updateEvery: Duration.days(3), models: modelSpecs(), modelsDir: join(dir, "models") }
  const [events, listed] = await run(options, (tools) => Effect.all([installAll(tools), tools.list]))
  assert.equal(requested.some((r) => r.endsWith(".onnx")), false, "no model was downloaded")
  assert.equal(events.some((e) => e._tag !== "Failed" && "name" in e && e.name === "background-removal"), false)
  const models = listed.find((t) => t.name === "background-removal")
  assert.equal(models?.required, false)
  assert.equal(models?.status, "missing")
})

test("the models download in the background, once, checked, and a thumbnail can wait for them", async () => {
  const dir = fresh("models-fetch")
  const modelsDir = join(dir, "models")
  requested.length = 0
  const options = { dir, path: "", specs: [], updateEvery: Duration.days(3), models: modelSpecs(), modelsDir }
  const messages: Array<string> = []
  const [started, waited, again, listed] = await run(options, (tools) =>
    Effect.gen(function*() {
      const started = yield* tools.prefetchBackgroundRemoval
      // a second caller waits on the same download instead of starting another
      const [waited, again] = yield* Effect.all([
        tools.ensureBackgroundRemoval((_, message) => Effect.sync(() => void messages.push(message))),
        tools.ensureBackgroundRemoval(() => Effect.void)
      ], { concurrency: "unbounded" })
      return [started, waited, again, yield* tools.list] as const
    }))
  assert.equal(started.status, "installing")
  assert.deepEqual([waited, again], ["ready", "ready"])
  assert.ok(messages.some((m) => /^Downloading background removal/.test(m)), "the wait says what it's waiting for")
  assert.equal(requested.filter((r) => r === "/isnet-general-use.onnx").length, 1, "downloaded once")
  for (const file of ["isnet-general-use.onnx", "u2net_human_seg.onnx"]) {
    assert.deepEqual(readFileSync(join(modelsDir, file)), files.get(`/${file}`))
  }
  assert.deepEqual(readdirSync(modelsDir).filter((f) => f.startsWith(".")), [], "no temporary files are left")
  const models = listed.find((t) => t.name === "background-removal")
  assert.equal(models?.status, "ready")
  assert.equal(models?.path, modelsDir)
})

test("a model whose checksum doesn't match is refused, and the wait gives up without failing", async () => {
  const dir = fresh("models-mismatch")
  const modelsDir = join(dir, "models")
  const bad = modelSpecs().map((m) => m.file === "u2net_human_seg.onnx" ? { ...m, sha256: "0".repeat(64) } : m)
  const options = { dir, path: "", specs: [], updateEvery: Duration.days(3), models: bad, modelsDir }
  const [result, listed] = await run(options, (tools) => Effect.all([tools.ensureBackgroundRemoval(() => Effect.void), tools.list]))
  assert.equal(result, "unavailable")
  assert.equal(existsSync(join(modelsDir, "u2net_human_seg.onnx")), false)
  assert.deepEqual(readdirSync(modelsDir).filter((f) => f.startsWith(".")), [], "no temporary files are left")
  const models = listed.find((t) => t.name === "background-removal")
  assert.equal(models?.status, "failed")
  assert.match(models?.error ?? "", /doesn't match the pinned/)
})
