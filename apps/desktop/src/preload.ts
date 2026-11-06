import { contextBridge, ipcRenderer } from "electron"

// What the UI learns from the desktop app: where the server is, the platform, how much room the window
// buttons take in the sidebar, and the user's name. Nothing else crosses into the page.
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? ""

contextBridge.exposeInMainWorld("viralDesktop", {
  platform: process.platform,
  serverUrl: arg("viral-server"),
  userName: arg("viral-user"),
  windowControlsInset: Number(arg("viral-inset")) || 0,
  // calls back with true/false whenever the window enters or leaves full screen; returns an unsubscribe
  // reveals a file or folder of the Viral library in Finder; resolves false when it isn't one
  showInFinder: (path: string): Promise<boolean> => ipcRenderer.invoke("viral:show-in-finder", path),
  // the macOS open panel for a video (or, with "audio", a music) file: its path, or null when cancelled
  openFile: (kind: "video" | "audio" = "video"): Promise<string | null> => ipcRenderer.invoke("viral:open-file", kind),
  onFullScreenChange: (listener: (fullScreen: boolean) => void) => {
    const handler = (_event: unknown, fullScreen: unknown) => listener(fullScreen === true)
    ipcRenderer.on("viral:full-screen", handler)
    return () => void ipcRenderer.removeListener("viral:full-screen", handler)
  }
})
