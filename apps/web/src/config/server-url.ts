// Where the Viral server is. The desktop app passes its address through the preload; in a browser the dev
// server's default (or VITE_VIRAL_SERVER) is used.
export interface DesktopBridge {
  readonly platform: string
  readonly serverUrl: string
  // how far the macOS window buttons reach into the sidebar, in px
  readonly windowControlsInset: number
  // the window entered (true) or left (false) full screen, where macOS hides the window buttons
  onFullScreenChange(listener: (fullScreen: boolean) => void): () => void
  // reveals a file or folder of the Viral library in Finder; resolves false when it isn't one
  showInFinder(path: string): Promise<boolean>
  // the macOS open panel for a video file: its path, or null when cancelled
  // the open panel for a video, or with "audio" a music file; its path, or null when cancelled
  openFile(kind?: "video" | "audio"): Promise<string | null>
  // several files at once (empty when cancelled), or a folder's path
  openFiles(kind: "video" | "audio"): Promise<ReadonlyArray<string>>
  openFolder(): Promise<string | null>
  // the path of a file dropped on the page; empty when it has none
  pathForFile(file: File): string
  // the signed-in Mac user's name, shown at the bottom of the sidebar
  readonly userName: string
}

declare global {
  interface Window {
    readonly viralDesktop?: DesktopBridge
  }
}

export const desktop: DesktopBridge | undefined = typeof window === "undefined" ? undefined : window.viralDesktop

export const serverUrl = (desktop?.serverUrl ?? import.meta.env["VITE_VIRAL_SERVER"] ?? "http://127.0.0.1:3410").replace(/\/$/, "")

export const rpcUrl = `${serverUrl.replace(/^http/, "ws")}/rpc`
