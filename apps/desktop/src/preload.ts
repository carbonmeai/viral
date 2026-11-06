import { contextBridge } from "electron"

// What the UI learns from the desktop app: where the server is, the platform, how much room the window
// buttons take in the sidebar, and the user's name. Nothing else crosses into the page.
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? ""

contextBridge.exposeInMainWorld("viralDesktop", {
  platform: process.platform,
  serverUrl: arg("viral-server"),
  userName: arg("viral-user"),
  windowControlsInset: Number(arg("viral-inset")) || 0
})
