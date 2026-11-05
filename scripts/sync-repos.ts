// Clones (or re-pins) read-only reference source into repos/ for coding agents.
// repos/ is gitignored; keep each ref in step with the dependency version in package.json.
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"

const REPOS = [{ name: "effect", url: "https://github.com/Effect-TS/effect.git", ref: "effect@4.1.2" }]

const git = (...args: Array<string>) => execFileSync("git", args, { stdio: "inherit" })

for (const { name, url, ref } of REPOS) {
  const dir = `repos/${name}`
  if (!existsSync(dir)) {
    git("-c", "advice.detachedHead=false", "clone", "--quiet", "--depth", "1", "--branch", ref, url, dir)
  } else {
    git("-C", dir, "fetch", "--quiet", "--depth", "1", "origin", "tag", ref)
    git("-C", dir, "checkout", "--quiet", ref)
  }
  console.log(`${dir} @ ${ref}`)
}
