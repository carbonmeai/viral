import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron"
import { openFileDialog } from "./open-file-kinds.ts"

// page → main: choose a video (or, for the music library, an audio) file with the macOS open panel; answers its
// path, or null when cancelled
export const OPEN_FILE_CHANNEL = "viral:open-file"

export const handleOpenFile = () =>
  ipcMain.handle(OPEN_FILE_CHANNEL, async (event, kind: unknown) => {
    const dialogFor = openFileDialog(kind)
    const options: OpenDialogOptions = {
      title: dialogFor.title,
      properties: ["openFile"],
      filters: [{ name: dialogFor.name, extensions: [...dialogFor.extensions] }]
    }
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
