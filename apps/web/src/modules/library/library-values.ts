import type { MusicTrack, Preset, PresetConfig, Project } from "@viral/contracts"
import type { EditorStepId } from "../shorts/editor-values.ts"

// Which shorts use each style. A short with no style of its own uses the default one.
export const shortsByStyle = (presets: ReadonlyArray<Preset>, projects: ReadonlyArray<Project>): ReadonlyMap<string, ReadonlyArray<Project>> => {
  const fallback = presets.find((p) => p.isDefault)?.id
  const byStyle = new Map<string, Array<Project>>(presets.map((p) => [p.id, []]))
  for (const project of projects) {
    const id = project.presetId ?? fallback
    if (id !== undefined) byStyle.get(id)?.push(project)
  }
  return byStyle
}

// Which shorts use each music track (a short without one is voice only).
export const shortsByTrack = (tracks: ReadonlyArray<MusicTrack>, projects: ReadonlyArray<Project>): ReadonlyMap<string, ReadonlyArray<Project>> =>
  new Map(tracks.map((t) => [t.id, projects.filter((p) => p.musicTrackId === t.id)]))

// Which styles narrate with a voice.
export const stylesByVoice = (presets: ReadonlyArray<Preset>, voiceId: string): ReadonlyArray<Preset> =>
  presets.filter((p) => p.config.voice.voiceId === voiceId)

// A name for a copy that isn't taken: "Viral recap copy", then "Viral recap copy 2", …
export const copyName = (name: string, taken: ReadonlyArray<string>): string => {
  const names = new Set(taken)
  const first = `${name} copy`
  if (!names.has(first)) return first
  for (let n = 2; ; n++) if (!names.has(`${first} ${n}`)) return `${first} ${n}`
}

// Where the build-up before a drop starts: `bars` bars of 4 beats before it, never before the track's start.
export const buildStart = (track: Pick<MusicTrack, "bpm" | "dropS">, bars = 8): number | null =>
  track.bpm === null || track.dropS === null || track.bpm <= 0 ? null : Math.max(0, track.dropS - (bars * 4 * 60) / track.bpm)

// The words a caption preview shows: as many as the style puts on screen, cased like the style, with the
// highlighted word (the last of the chunk).
export const sampleCaption = (config: PresetConfig): { readonly words: ReadonlyArray<string>; readonly highlight: number } => {
  const source = ["this", "candy", "hits", "every", "taste", "at", "once"]
  const count = config.captions.mode === "word" ? 1 : Math.max(1, Math.min(config.captions.maxWords, source.length))
  const cased = source.slice(0, count).map((w) =>
    config.captions.case === "upper" ? w.toUpperCase() : config.captions.case === "lower" ? w : w[0]!.toUpperCase() + w.slice(1)
  )
  return { words: cased, highlight: count - 1 }
}

// The preview's geometry as fractions of its height, from the style's canvas: the sharp band (band framing),
// the headline's top and size, and the captions' centre.
export const previewLayout = (config: PresetConfig) => {
  const [width, height] = config.canvas
  return {
    band: config.framing === "band" ? config.mainHeight / height : 1,
    headlineTop: config.headline?.y ?? null,
    // the headline's size is a fraction of the width; as a fraction of the height for CSS
    headlineSize: config.headline === null ? null : (config.headline.size * width) / height,
    captionY: config.captions.y
  }
}

// "2:16" for a track's length.
export const trackLength = (seconds: number | null): string => {
  if (seconds === null) return "—"
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

// What to show when a save is refused: the server's own problems for a style, or a plain reason.
export const refusal = (error: unknown): ReadonlyArray<string> => {
  if (typeof error !== "object" || error === null) return ["That didn’t save. Try again."]
  const tagged = error as { readonly _tag?: unknown; readonly problems?: unknown; readonly presetName?: unknown; readonly message?: unknown }
  if (Array.isArray(tagged.problems)) return tagged.problems.filter((p): p is string => typeof p === "string")
  if (tagged._tag === "PresetNameTaken") return [`There’s already a style called “${String(tagged.presetName)}”.`]
  if (tagged._tag === "PresetIsDefault") return ["The default style can’t be deleted. Make another style the default first."]
  if (tagged._tag === "MusicFileUnreadable") return ["Viral couldn’t read that file as audio."]
  return [typeof tagged.message === "string" && tagged.message !== "" ? tagged.message : "That didn’t save. Try again."]
}

// The editor step a "Used by" link opens at: the Music step when the editor has one, else the short itself.
export const musicStep = (steps: ReadonlyArray<EditorStepId>): EditorStepId | undefined => steps.find((step) => String(step) === "music")

const AUDIO_FILE = /\.(mp3|m4a|aac|wav|aif|aiff|flac|ogg|opus)$/i

// A typed path (in a browser, where there's no open panel): an audio file is one song, anything else a folder.
export const pathKind = (path: string): "file" | "folder" => AUDIO_FILE.test(path.trim()) ? "file" : "folder"

// The file name a path ends in, for listing chosen songs.
export const fileName = (path: string): string => path.split("/").filter((part) => part !== "").at(-1) ?? path
