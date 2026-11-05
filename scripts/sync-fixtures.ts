// Copies the candy project's plan and transcript files from the original viral-shorts skill into
// ~/.viral/fixtures/candy for contract and regression tests. Fixtures stay out of git: they are
// large and contain other people's content.
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const from = process.env.VIRAL_CANDY_SOURCE ?? join(homedir(), "Apps/youtube/work/candy")
const to = join(homedir(), ".viral/fixtures/candy")

const FILES = [
  "transcript.json",
  "narrated.json",
  "vo_tx/transcript.json",
  "shorts/01-every-taste-candy.thumb.json"
]

if (!existsSync(from)) {
  console.error(`candy project not found at ${from} (set VIRAL_CANDY_SOURCE)`)
  process.exit(1)
}
for (const file of FILES) {
  mkdirSync(dirname(join(to, file)), { recursive: true })
  copyFileSync(join(from, file), join(to, file))
  console.log(`${to}/${file}`)
}
