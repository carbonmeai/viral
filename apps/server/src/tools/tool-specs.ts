import type { ToolName } from "@viral/contracts"

// How Viral installs a tool: a pinned download checked against its checksum, or a Python tool through uv
// (yt-dlp: its standalone macOS build unpacks itself on every start, half a minute each time, where uv's
// install starts in about a second and upgrades in place).
export type ToolSpec = DownloadSpec | UvToolSpec

export interface DownloadSpec {
  readonly name: BinaryName
  readonly via: "download"
  readonly url: string
  // the publisher's SHA-256, or null to trust the first download and record its hash (ffmpeg-static
  // publishes none); a later download with a different hash is refused
  readonly sha256: string | null
  // a .tar.gz whose `member` is the binary
  readonly archive?: { readonly member: string }
}

export interface UvToolSpec {
  readonly name: BinaryName
  readonly via: "uv-tool"
  // the PyPI package `uv tool install` installs
  readonly package: string
}

// The tools that are programs on the PATH (the background-removal models aren't).
export type BinaryName = Exclude<ToolName, "background-removal">

// How each tool prints its version.
export const VERSION_ARGS: Record<BinaryName, ReadonlyArray<string>> = {
  ffmpeg: ["-version"],
  ffprobe: ["-version"],
  uv: ["--version"],
  "yt-dlp": ["--version"]
}

export const TOOL_NAMES: ReadonlyArray<BinaryName> = ["ffmpeg", "ffprobe", "uv", "yt-dlp"]

// A background-removal model rembg loads by file name from its models folder (U2NET_HOME). The checksums are
// of rembg's own release files, which match the MD5s rembg publishes for them.
export interface ModelSpec {
  readonly file: string
  readonly url: string
  readonly sha256: string
  // bytes, for progress before the download says its size
  readonly size: number
}

export const BACKGROUND_REMOVAL_MODELS: ReadonlyArray<ModelSpec> = [
  {
    // objects: the hero (candy, a tray of skulls)
    file: "isnet-general-use.onnx",
    url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx",
    sha256: "60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a",
    size: 178648008
  },
  {
    // people: the reaction face
    file: "u2net_human_seg.onnx",
    url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net_human_seg.onnx",
    sha256: "01eb6a29a5c4d8edb30b56adad9bb3a2a0535338e480724a213e0acfd2d1c73c",
    size: 175997641
  }
]

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
