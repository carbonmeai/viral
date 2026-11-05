// Copies the candy project from the original viral-shorts skill into ~/.viral/fixtures/candy for
// contract and regression tests. Fixtures stay out of git: they are large and contain other people's
// content. Files already copied (same size) are skipped.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const from = process.env.VIRAL_CANDY_SOURCE ?? join(homedir(), "Apps/youtube/work/candy")
const to = join(homedir(), ".viral/fixtures/candy")

// [path in the candy project, path in the fixture]
const FILES: ReadonlyArray<readonly [string, string]> = [
  // plan, transcripts, thumbnail config
  ["transcript.json", "transcript.json"],
  ["narrated.json", "narrated.json"],
  ["vo_tx/transcript.json", "vo_tx/transcript.json"],
  ["shorts/01-every-taste-candy.thumb.json", "shorts/01-every-taste-candy.thumb.json"],
  // render inputs (source.mp4 is a symlink into ~/Downloads; the copy follows it)
  ["source.mp4", "source.mp4"],
  ["vo.wav", "vo.wav"],
  ["../../music/viral_drop_song.wav", "music/viral_drop_song.wav"],
  // golden outputs the renderer must reproduce
  ["shorts/01-every-taste-candy.mp4", "golden/01-every-taste-candy.mp4"],
  ["shorts/01-every-taste-candy.srt", "golden/01-every-taste-candy.srt"]
]

if (!existsSync(from)) {
  console.error(`candy project not found at ${from} (set VIRAL_CANDY_SOURCE)`)
  process.exit(1)
}
for (const [src, dest] of FILES) {
  const source = join(from, src)
  const target = join(to, dest)
  if (existsSync(target) && statSync(target).size === statSync(source).size) {
    console.log(`= ${target}`)
    continue
  }
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  console.log(`+ ${target}`)
}
