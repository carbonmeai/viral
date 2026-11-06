// The files the open panel offers for each kind.
export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "mkv", "webm", "avi"]
export const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "aiff", "aif"]

export type OpenFileKind = "video" | "audio"

// The open panel's title and filter for a kind; anything unexpected is treated as a video.
export const openFileDialog = (kind: unknown): { readonly title: string; readonly name: string; readonly extensions: ReadonlyArray<string> } =>
  kind === "audio"
    ? { title: "Choose a music track", name: "Audio", extensions: AUDIO_EXTENSIONS }
    : { title: "Choose a video", name: "Videos", extensions: VIDEO_EXTENSIONS }
