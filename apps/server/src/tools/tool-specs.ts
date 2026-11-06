import type { ToolName } from "@viral/contracts"

// How Viral installs a tool: a pinned download checked against its checksum, or a Python tool through uv
// (yt-dlp: its standalone macOS build unpacks itself on every start, half a minute each time, where uv's
// install starts in about a second and upgrades in place).
export type ToolSpec = DownloadSpec | UvToolSpec

export interface DownloadSpec {
  readonly name: ToolName
  readonly via: "download"
  readonly url: string
  // the publisher's SHA-256, or null to trust the first download and record its hash (ffmpeg-static
  // publishes none); a later download with a different hash is refused
  readonly sha256: string | null
  // a .tar.gz whose `member` is the binary
  readonly archive?: { readonly member: string }
}

export interface UvToolSpec {
  readonly name: ToolName
  readonly via: "uv-tool"
  // the PyPI package `uv tool install` installs
  readonly package: string
}

// How each tool prints its version.
export const VERSION_ARGS: Record<ToolName, ReadonlyArray<string>> = {
  ffmpeg: ["-version"],
  ffprobe: ["-version"],
  uv: ["--version"],
  "yt-dlp": ["--version"]
}

export const TOOL_NAMES: ReadonlyArray<ToolName> = ["ffmpeg", "ffprobe", "uv", "yt-dlp"]

// Pinned downloads per platform (`${process.platform}-${process.arch}`). A platform without pins can still
// use tools from its PATH.
export const TOOL_SPECS: Record<string, ReadonlyArray<ToolSpec>> = {
  "darwin-arm64": [
    {
      name: "uv",
      via: "download",
      url: "https://github.com/astral-sh/uv/releases/download/0.13.7/uv-aarch64-apple-darwin.tar.gz",
      sha256: "81b811b57e4624df7ed3aac148e0359100d9962f3d9dce00aec533dc2e086731",
      archive: { member: "uv-aarch64-apple-darwin/uv" }
    },
    // after uv, which installs it
    { name: "yt-dlp", via: "uv-tool", package: "yt-dlp" },
    { name: "ffmpeg", via: "download", url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64", sha256: null },
    { name: "ffprobe", via: "download", url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-darwin-arm64", sha256: null }
  ]
}
