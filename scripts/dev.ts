// `bun run dev`: the web dev server, then the desktop app (which starts the Viral server itself). Ctrl-C
// stops everything. Set VIRAL_HOME to use another library, e.g. ~/.viral/work/live-check.
import { spawn } from "node:child_process"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const children: Array<ReturnType<typeof spawn>> = []
const run = (cwd: string, command: string, args: ReadonlyArray<string>) => {
  // its own process group, so stopping it also stops what it started (vp launches another node)
  const child = spawn(command, args, { cwd: resolve(root, cwd), stdio: "inherit", env: process.env, detached: true })
  children.push(child)
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) console.error(`${cwd}: ${command} exited with ${code}`)
    stop()
  })
  return child
}
const stop = () => {
  for (const child of children) {
    if (child.exitCode !== null || child.pid === undefined) continue
    try {
      process.kill(-child.pid, "SIGTERM")
    } catch {
      // already gone
    }
  }
}
process.on("SIGINT", stop)
process.on("SIGTERM", stop)

run("apps/web", "node_modules/.bin/vp", ["dev"])
// the desktop app's main process is bundled first, then Electron opens the dev UI
const pack = spawn("node_modules/.bin/vp", ["pack"], { cwd: resolve(root, "apps/desktop"), stdio: "inherit" })
pack.on("exit", (code) => {
  if (code === 0) run("apps/desktop", "node_modules/.bin/electron", ["."])
  else stop()
})
