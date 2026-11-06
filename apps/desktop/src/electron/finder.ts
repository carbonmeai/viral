import { ipcMain, shell } from "electron"
import { existsSync, statSync } from "node:fs"
import { isInsideLibrary } from "./finder-path.ts"

// page → main: reveal a file or folder of the Viral library in Finder
export const SHOW_IN_FINDER_CHANNEL = "viral:show-in-finder"

// Answers the page's "Show in Finder": only paths inside the library, and only ones that exist.
export const handleShowInFinder = (library: string) =>
  ipcMain.handle(SHOW_IN_FINDER_CHANNEL, (_event, target: unknown) => {
    if (typeof target !== "string" || !isInsideLibrary(library, target) || !existsSync(target)) return false
    if (statSync(target).isDirectory()) void shell.openPath(target)
    else shell.showItemInFolder(target)
    return true
  })
