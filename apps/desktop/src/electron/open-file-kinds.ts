// The files the open panel offers for each kind.
export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "mkv", "webm", "avi"]
export const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "aiff", "aif"]

export type OpenFileKind = "video" | "audio"

// The open panel's title and filter for a kind; anything unexpected is treated as a video.
export const openFileDialog = (kind: unknown): { readonly title: string; readonly name: string; readonly extensions: ReadonlyArray<string> } =>
  kind === "audio"
    ? { title: "Choose a music track", name: "Audio", extensions: AUDIO_EXTENSIONS }
    : { title: "Choose a video", name: "Videos", extensions: VIDEO_EXTENSIONS }

// How many things the panel picks: one file, several files, or a folder.
export type OpenMode = "one" | "many" | "folder"

// The page asks with a kind, or { kind, mode }; anything else is one video.
export const openRequest = (arg: unknown): { readonly kind: OpenFileKind; readonly mode: OpenMode } => {
  const value = typeof arg === "object" && arg !== null ? arg as { readonly kind?: unknown; readonly mode?: unknown } : { kind: arg }
  const kind: OpenFileKind = value.kind === "audio" ? "audio" : "video"
  const mode: OpenMode = value.mode === "many" || value.mode === "folder" ? value.mode : "one"
  return { kind, mode }
}
