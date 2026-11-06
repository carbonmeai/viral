import type { Tool } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { foldInstall, formatBytes, initialInstall, installFinished, toolsToInstall } from "./tools-values.ts"

const tool = (name: Tool["name"], status: Tool["status"]): Tool => ({ name, status, source: status === "ready" ? "system" : null, version: null, path: null, error: null })
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
