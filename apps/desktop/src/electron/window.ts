import { BrowserWindow, nativeTheme, shell } from "electron"
import { join } from "node:path"
import { isAppUrl } from "../backend/server-launch.ts"

// The sidebar's top row is 44px; the macOS window buttons (12px) sit centred in it, 16px from the edge.
const TOP_ROW = 44
const BUTTON = 12
export const WINDOW_CONTROLS_INSET = 76
// main → page: whether the window is in full screen (true/false)
export const FULL_SCREEN_CHANNEL = "viral:full-screen"

export interface WindowInput {
  readonly url: string
  readonly appOrigins: ReadonlyArray<string>
  readonly preload: string
  readonly serverUrl: string
  readonly userName: string
}

// One main window: hidden title bar with the window buttons over the sidebar, sandboxed renderer, and
// navigation locked to the app. Links to anywhere else open in the browser.
export const createMainWindow = (input: WindowInput) => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: "Viral",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: TOP_ROW / 2 - BUTTON / 2 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0d0d0d" : "#ffffff",
    webPreferences: {
      preload: input.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      additionalArguments: [
        `--viral-server=${input.serverUrl}`,
        `--viral-user=${input.userName}`,
        `--viral-inset=${WINDOW_CONTROLS_INSET}`
      ]
    }
  })
  window.once("ready-to-show", () => window.show())
  // macOS hides the window buttons in full screen; the UI reclaims their space in the sidebar's top row
  const sendFullScreen = () => window.webContents.send(FULL_SCREEN_CHANNEL, window.isFullScreen())
  window.on("enter-full-screen", sendFullScreen)
  window.on("leave-full-screen", sendFullScreen)
  window.webContents.on("did-finish-load", sendFullScreen)
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url, input.appOrigins)) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url)
    return { action: "deny" }
  })
  void window.loadURL(input.url)
  return window
}

export const preloadPath = (distDir: string) => join(distDir, "preload.cjs")
