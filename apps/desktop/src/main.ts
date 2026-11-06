import { NodeServices } from "@effect/platform-node"
import { Effect, Layer, ManagedRuntime } from "effect"
import { app } from "electron"
import { homedir, userInfo } from "node:os"
import { join, resolve } from "node:path"
import { ServerProcess } from "./backend/server-process.ts"
import { APP_ORIGIN, registerAppSchemePrivileges, serveAppProtocol } from "./electron/app-protocol.ts"
import { handleShowInFinder } from "./electron/finder.ts"
import { handleOpenFile } from "./electron/open-file.ts"
import { startUpdates } from "./electron/updater.ts"
import { createMainWindow, preloadPath } from "./electron/window.ts"

// The Viral desktop app: starts the local server, then opens the UI. In development the UI comes from the
// web dev server (VIRAL_WEB_DEV_URL, default :5733); packaged, from Resources/web over viral://app/.
const PORT = Number(process.env["VIRAL_PORT"] ?? 3410)
const packaged = app.isPackaged
const devUrl = process.env["VIRAL_WEB_DEV_URL"] ?? "http://127.0.0.1:5733"

registerAppSchemePrivileges()

const runtime = ManagedRuntime.make(
  ServerProcess.layer({
    packaged,
    execPath: process.execPath,
    resourcesPath: process.resourcesPath,
    // dist-electron/ → apps/desktop → apps → repo
    repoRoot: resolve(__dirname, "../../.."),
    port: PORT,
    path: process.env["PATH"] ?? "",
    parentPid: process.pid
  }).pipe(Layer.provide(NodeServices.layer))
)

const userName = () => {
  try {
    return userInfo().username
  } catch {
    return ""
  }
}

const start = Effect.gen(function*() {
  const server = yield* ServerProcess
  yield* Effect.promise(() => app.whenReady())
  // the server's library: VIRAL_HOME (inherited by the server) or ~/.viral
  handleShowInFinder(process.env["VIRAL_HOME"] ?? join(homedir(), ".viral"))
  handleOpenFile()
  if (packaged) serveAppProtocol(join(process.resourcesPath, "web"), server.url)
  yield* server.ready.pipe(Effect.timeout("60 seconds"), Effect.orElseSucceed(() => undefined))
  createMainWindow({
    url: packaged ? `${APP_ORIGIN}/index.html` : devUrl,
    appOrigins: packaged ? [APP_ORIGIN] : [new URL(devUrl).origin],
    preload: preloadPath(__dirname),
    serverUrl: server.url,
    userName: userName()
  })
  startUpdates(packaged, process.env["VIRAL_UPDATE_URL"], (message) => console.log(`[updates] ${message}`))
})

runtime.runPromise(start).catch((error: unknown) => {
  console.error("Viral couldn't start", error)
  app.exit(1)
})

app.on("window-all-closed", () => app.quit())

// A terminal's Ctrl-C or a SIGTERM quits like the menu does, so the server is stopped too.
process.on("SIGTERM", () => app.quit())
process.on("SIGINT", () => app.quit())

// Give the server its grace period before the app exits.
let stopping = false
app.on("before-quit", (event) => {
  if (stopping) return
  stopping = true
  event.preventDefault()
  void runtime.dispose().finally(() => app.quit())
})
