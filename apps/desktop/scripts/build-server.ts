// Puts the server's own files next to its bundle (dist-server/main.mjs), where the server looks for them
// with import.meta.dirname: the Python scripts (flat; their names are unique) and the skill pack.
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { join, resolve } from "node:path"

const serverSrc = resolve(import.meta.dirname, "../../server/src")
const out = resolve(import.meta.dirname, "../dist-server")
if (!existsSync(join(out, "main.mjs"))) throw new Error("dist-server/main.mjs is missing: run `vp pack` first")
mkdirSync(out, { recursive: true })

const scripts: Array<string> = []
const walk = (dir: string): void => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name !== "testing" && name !== "skills") walk(path)
    } else if (name.endsWith(".py")) {
      scripts.push(path)
    }
  }
}
walk(serverSrc)

const seen = new Set<string>()
for (const script of scripts) {
  const name = script.slice(script.lastIndexOf("/") + 1)
  if (seen.has(name)) throw new Error(`two server scripts are called ${name}; the bundle keeps them in one folder`)
  seen.add(name)
  cpSync(script, join(out, name))
}
cpSync(join(serverSrc, "agent-skills/skills"), join(out, "skills"), { recursive: true })
console.log(`dist-server: main.mjs, ${scripts.length} scripts, skills/`)
