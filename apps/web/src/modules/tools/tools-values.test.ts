import type { Tool } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { downloadFraction, foldInstall, formatBytes, initialInstall, installFinished, offersFallbackDownload, shortVersion, toolsToInstall } from "./tools-values.ts"

const tool = (name: Tool["name"], status: Tool["status"]): Tool => ({
  name,
  status,
  source: status === "ready" ? "system" : null,
  version: null,
  path: null,
  error: null,
  required: name !== "background-removal",
  progress: null
})
const tools = [tool("ffmpeg", "ready"), tool("uv", "missing"), tool("yt-dlp", "failed")]

test("only missing or failed tools are installed, each starting as waiting", () => {
  assert.deepEqual(toolsToInstall(tools).map((t) => t.name), ["uv", "yt-dlp"])
  const state = initialInstall(tools)
  assert.deepEqual(Object.keys(state), ["uv", "yt-dlp"])
  assert.equal(state.uv?.phase, "waiting")
  assert.equal(installFinished(state), false)
})

test("progress events move each tool through downloading to installed or failed", () => {
  let state = initialInstall(tools)
  state = foldInstall(state, { _tag: "Downloading", name: "uv", bytes: 512, total: 1024 })
  assert.deepEqual([state.uv?.phase, state.uv?.bytes, state.uv?.total], ["downloading", 512, 1024])
  state = foldInstall(state, { _tag: "Installed", tool: { ...tool("uv", "ready"), source: "viral", version: "uv 0.13.7" } })
  assert.deepEqual([state.uv?.phase, state.uv?.version, state.uv?.bytes], ["installed", "uv 0.13.7", 1024])
  state = foldInstall(state, { _tag: "Failed", name: "yt-dlp", message: "checksum mismatch" })
  assert.equal(state["yt-dlp"]?.message, "checksum mismatch")
  assert.equal(installFinished(state), true)
})

test("sizes read in KB or MB", () => {
  assert.equal(formatBytes(300), "1 KB")
  assert.equal(formatBytes(80 * 1024 * 1024), "80.0 MB")
})

test("versions read as just the number", () => {
  assert.equal(shortVersion("ffprobe version 6.0 Copyright (c) 2007-2023 the FFmpeg developers"), "6.0")
  assert.equal(shortVersion("uv 0.13.7 (316c827e0 2026-11-03 aarch64-apple-darwin)"), "0.13.7")
  assert.equal(shortVersion("2026.10.26"), "2026.10.26")
  assert.equal(shortVersion(null), null)
})

test("first run never waits for the background-removal models", () => {
  const withModels = [...tools, tool("background-removal", "missing")]
  assert.deepEqual(toolsToInstall(withModels).map((t) => t.name), ["uv", "yt-dlp"])
  assert.deepEqual(Object.keys(initialInstall(withModels)), ["uv", "yt-dlp"])
})

test("a background download's progress is a fraction once its size is known", () => {
  const models = tool("background-removal", "installing")
  assert.equal(downloadFraction({ ...models, progress: { bytes: 50, total: 200 } }), 0.25)
  assert.equal(downloadFraction({ ...models, progress: { bytes: 50, total: null } }), null)
  assert.equal(downloadFraction(models), null)
})

test("with Apple's cut-out, the fallback models are offered until they're downloaded", () => {
  const apple = (version: string) => ({ ...tool("background-removal", "ready"), version })
  assert.equal(offersFallbackDownload(apple("Apple's built-in cut-out · rembg fallback downloads if needed")), true)
  assert.equal(offersFallbackDownload(apple("Apple's built-in cut-out · rembg fallback downloaded")), false)
  assert.equal(offersFallbackDownload(apple("2 models · 355 MB")), false, "rembg itself, not a fallback")
  assert.equal(offersFallbackDownload({ ...tool("ffmpeg", "ready"), version: "Apple's built-in cut-out" }), false)
})
