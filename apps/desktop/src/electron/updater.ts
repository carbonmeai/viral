import { autoUpdater } from "electron-updater"

// Checks for a new version when the app starts, downloads it in the background and installs it on quit.
// The feed is VIRAL_UPDATE_URL (an electron-builder "generic" feed); without it, or in development,
// updates are off. Nothing is published yet.
export const startUpdates = (packaged: boolean, feed: string | undefined, log: (message: string) => void) => {
  if (!packaged || feed === undefined || feed === "") {
    log("updates are off (development, or no VIRAL_UPDATE_URL)")
    return
  }
  autoUpdater.setFeedURL({ provider: "generic", url: feed })
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on("error", (error) => log(`update check failed: ${error.message}`))
  autoUpdater.on("update-downloaded", (info) => log(`version ${info.version} is ready; it installs when you quit`))
  void autoUpdater.checkForUpdates()
}
