// Downloads the tools the packaged app bundles (macOS arm64) into resources/bin, which electron-builder puts
// in Viral.app/Contents/Resources/bin. The server finds them first on its PATH. Run before packaging:
//   bun run --cwd apps/desktop fetch-tools
// Every download is checked against a pinned SHA-256: the publisher's own checksum where it has one (uv,
// yt-dlp), otherwise the hash recorded on first fetch in resources/bin/tools.lock.json (ffmpeg-static
// publishes none). A mismatch stops the script.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

interface Tool {
  readonly name: string
  readonly url: string
  // the publisher's checksum, or null to trust-and-record on first fetch
  readonly sha256: string | null
  // a .tar.gz whose member `file` is the binary
  readonly archive?: { readonly member: string }
}

const TOOLS: ReadonlyArray<Tool> = [
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

const bin = resolve(import.meta.dirname, "../resources/bin")
const lockFile = join(bin, "tools.lock.json")
mkdirSync(bin, { recursive: true })
const lock: Record<string, { url: string; sha256: string }> = existsSync(lockFile) ? JSON.parse(readFileSync(lockFile, "utf8")) : {}

for (const tool of TOOLS) {
  const response = await fetch(tool.url)
  if (!response.ok) throw new Error(`${tool.name}: ${response.status} from ${tool.url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  const expected = tool.sha256 ?? (lock[tool.name]?.url === tool.url ? lock[tool.name]?.sha256 : undefined)
  if (expected !== undefined && expected !== sha256) {
    throw new Error(`${tool.name}: checksum ${sha256} doesn't match the pinned ${expected}; not installing it`)
  }
  if (expected === undefined) console.log(`${tool.name}: no published checksum; recording ${sha256} for next time`)
  lock[tool.name] = { url: tool.url, sha256 }

  const target = join(bin, tool.name)
  if (tool.archive === undefined) {
    writeFileSync(target, bytes)
  } else {
    const archive = join(bin, `${tool.name}.tar.gz`)
    writeFileSync(archive, bytes)
    execFileSync("tar", ["-xzf", archive, "-C", bin, "--strip-components", "1", tool.archive.member])
    rmSync(archive)
  }
  chmodSync(target, 0o755)
  console.log(`${tool.name}: ok`)
}
writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`)
