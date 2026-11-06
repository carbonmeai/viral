import type { ToolName } from "@viral/contracts"

// Where Viral downloads a tool from, and how it checks the download.
export interface ToolSpec {
  readonly name: ToolName
  readonly url: string
  // the publisher's SHA-256, or null to trust the first download and record its hash (ffmpeg-static
  // publishes none); a later download with a different hash is refused
  readonly sha256: string | null
  // a .tar.gz whose `member` is the binary
  readonly archive?: { readonly member: string }
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
      url: "https://github.com/astral-sh/uv/releases/download/0.13.7/uv-aarch64-apple-darwin.tar.gz",
      sha256: "81b811b57e4624df7ed3aac148e0359100d9962f3d9dce00aec533dc2e086731",
      archive: { member: "uv-aarch64-apple-darwin/uv" }
    },
    {
      name: "yt-dlp",
      url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp_macos",
      sha256: "0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa"
    },
    { name: "ffmpeg", url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64", sha256: null },
    { name: "ffprobe", url: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-darwin-arm64", sha256: null }
  ]
}
