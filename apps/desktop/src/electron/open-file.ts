import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron"
import { openFileDialog, openRequest } from "./open-file-kinds.ts"

// page → main: choose a video (or, for the music library, an audio) file with the macOS open panel; answers its
// path, or null when cancelled
export const OPEN_FILE_CHANNEL = "viral:open-file"

export const handleOpenFile = () =>
  ipcMain.handle(OPEN_FILE_CHANNEL, async (event, arg: unknown) => {
    const { kind, mode } = openRequest(arg)
    const dialogFor = openFileDialog(kind)
    const options: OpenDialogOptions = mode === "folder"
      ? { title: kind === "audio" ? "Choose a folder of songs" : "Choose a folder", properties: ["openDirectory"] }
      : {
        title: dialogFor.title,
        properties: mode === "many" ? ["openFile", "multiSelections"] : ["openFile"],
        filters: [{ name: dialogFor.name, extensions: [...dialogFor.extensions] }]
      }
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options)
    if (result.canceled) return mode === "many" ? [] : null
    return mode === "many" ? result.filePaths : result.filePaths[0] ?? null
  })
