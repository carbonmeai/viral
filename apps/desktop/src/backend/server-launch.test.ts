import assert from "node:assert/strict"
import { test } from "node:test"
import { contentSecurityPolicy, isAppUrl, restartDelayMs, serverLaunch } from "./server-launch.ts"

const base = { execPath: "/Applications/Viral.app/Contents/MacOS/Viral", resourcesPath: "/Applications/Viral.app/Contents/Resources", repoRoot: "/repo", port: 3410, path: "/usr/bin:/bin" }

test("packaged builds run the bundled server on Electron's Node, bundled tools first", () => {
  const launch = serverLaunch({ ...base, packaged: true })
  assert.equal(launch.command, base.execPath)
  assert.deepEqual(launch.args, ["/Applications/Viral.app/Contents/Resources/server/main.mjs"])
  assert.equal(launch.env["ELECTRON_RUN_AS_NODE"], "1")
  assert.equal(launch.env["PATH"], "/Applications/Viral.app/Contents/Resources/bin:/usr/bin:/bin")
  assert.equal(launch.env["VIRAL_PORT"], "3410")
})

test("development runs the server's TypeScript from the repo", () => {
  const launch = serverLaunch({ ...base, packaged: false })
  assert.equal(launch.command, "node")
  assert.deepEqual(launch.args, ["--env-file-if-exists=.env", "apps/server/src/main.ts"])
  assert.equal(launch.env["ELECTRON_RUN_AS_NODE"], undefined)
})

test("restarts back off from half a second to ten", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(restartDelayMs), [500, 1000, 2000, 4000, 8000, 10000, 10000])
})

test("the policy allows only the app and the local server", () => {
  const csp = contentSecurityPolicy("viral", "http://127.0.0.1:3410")
  assert.match(csp, /connect-src 'self' http:\/\/127\.0\.0\.1:3410 ws:\/\/127\.0\.0\.1:3410/)
  assert.match(csp, /media-src 'self' viral: blob: http:\/\/127\.0\.0\.1:3410/)
  assert.match(csp, /script-src 'self';/)
})

test("navigation stays on the app's own origins", () => {
  const origins = ["viral://app", "http://127.0.0.1:5733"]
  assert.equal(isAppUrl("viral://app/index.html#/", origins), true)
  assert.equal(isAppUrl("http://127.0.0.1:5733/#/waiting", origins), true)
  assert.equal(isAppUrl("https://example.com/", origins), false)
  assert.equal(isAppUrl("file:///etc/passwd", origins), false)
  assert.equal(isAppUrl("not a url", origins), false)
})
