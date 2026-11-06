import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron"

// page → main: choose a video file with the macOS open panel; answers its path, or null when cancelled
export const OPEN_FILE_CHANNEL = "viral:open-file"

// The video files the open panel offers.
export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "mkv", "webm", "avi"]

export const handleOpenFile = () =>
  ipcMain.handle(OPEN_FILE_CHANNEL, async (event) => {
    const options: OpenDialogOptions = {
      title: "Choose a video",
      properties: ["openFile"],
      filters: [{ name: "Videos", extensions: VIDEO_EXTENSIONS }]
    }
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window === null ? await dialog.showOpenDialog(options) : await dialog.showOpenDialog(window, options)
    return result.canceled ? null : result.filePaths[0] ?? null
  })
