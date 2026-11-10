import type { LibraryVoice, MusicTrack, ReferenceVideo, Rights, SoundEffect } from "@viral/contracts"

// The Library panel's tabs: this short's own things, everything in your library, and things to explore.
export type LibraryTab = "short" | "library" | "explore"
export type LibraryType = "All" | "Videos" | "Frames" | "Clips" | "Music" | "Voice" | "Voices" | "Sounds" | "References"
export const LIBRARY_TYPES: ReadonlyArray<LibraryType> = ["All", "Videos", "Frames", "Clips", "Voices", "Music", "Voice", "Sounds", "References"]

// One tile in the panel's grid. `video` is its video's place in the short (its colour and short name), `used` whether
// this short uses it, `rights` what you said about the footage or song.
export interface LibraryItem {
  readonly key: string
  readonly type: Exclude<LibraryType, "All">
  readonly name: string
  readonly sub: string
  readonly picture: string | null
  // a small count on the picture (a length, a clip's seconds)
  readonly badge: string | null
  readonly video: number | null
  readonly used: boolean
  readonly rights: Rights | null
}

export interface LibraryFilter {
  readonly type: LibraryType
  readonly query: string
  // only one video's items (its place in the short)
  readonly video: number | null
  // used in this short, or not yet
  readonly used: boolean | null
  readonly rights: Rights | null
}

export const NO_FILTER: LibraryFilter = { type: "All", query: "", video: null, used: null, rights: null }

// The type chips worth showing: All, then each type that has an item (Frames always on a short's tab once it has
// any, since the Shots step opens on them).
// `always` are shown even with nothing in them (a short's Frames, so its empty state says when they come).
export const typesOf = (items: ReadonlyArray<LibraryItem>, always: ReadonlyArray<LibraryType> = []): ReadonlyArray<LibraryType> =>
  LIBRARY_TYPES.filter((t) => t === "All" || always.includes(t) || items.some((i) => i.type === t))

// The items a filter keeps, in their order. The search matches the name and the line under it.
export const filterItems = <T extends LibraryItem>(items: ReadonlyArray<T>, filter: LibraryFilter): ReadonlyArray<T> => {
  const q = filter.query.trim().toLowerCase()
  return items.filter((i) =>
    (filter.type === "All" || i.type === filter.type) &&
    (filter.video === null || i.video === filter.video) &&
    (filter.used === null || i.used === filter.used) &&
    (filter.rights === null || i.rights === filter.rights) &&
    (q === "" || i.name.toLowerCase().includes(q) || i.sub.toLowerCase().includes(q))
  )
}

// "27:12", "1:02:05": a moment of a video.
export const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

// "21 shots · 2 real lines": what a short takes from one of its videos.
export const usesLine = (shots: number, reals: number, noun: "shot" | "section" | "moment" = "shot") =>
  [
    shots === 0 ? null : `${shots} ${noun}${shots === 1 ? "" : "s"}`,
    reals === 0 ? null : `${reals} real line${reals === 1 ? "" : "s"}`
  ].filter((x) => x !== null).join(" · ") || "Not used yet"

export const RIGHTS_NAMES: Record<Rights, string> = { owned: "Mine", licensed: "Allowed", unconfirmed: "Not sure" }

// What a tile in Your library or Explore does when clicked: play a free sample or a sound, open the song picker with
// that song, or open a kept reference's page.
export type LibraryTarget =
  | { readonly _tag: "Play"; readonly url: string }
  | { readonly _tag: "Song"; readonly trackId: string }
  | { readonly _tag: "Link"; readonly url: string }
  | { readonly _tag: "None" }

export type TargetedItem = LibraryItem & { readonly target: LibraryTarget }

const users = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M uses` : n >= 1000 ? `${Math.round(n / 1000)}k uses` : `${n} uses`
const seconds = (s: number) => s < 60 ? `${s.toFixed(1)}s` : clock(s)

// The sounds you made or added (Your library) or the ones that come with Viral (Explore). `url` makes a sound's file's
// address.
export const soundItems = (sounds: ReadonlyArray<SoundEffect>, bundled: boolean, url: (path: string) => string): ReadonlyArray<TargetedItem> =>
  sounds.filter((s) => (s.origin._tag === "Bundled") === bundled).map((s) => ({
    key: `sound-${s.id}`,
    type: "Sounds",
    name: s.name,
    sub: `${seconds(s.durationS)} · ${s.origin._tag === "Generated" ? "made with ElevenLabs" : s.origin._tag === "Bundled" ? "free to use" : "yours"}`,
    picture: null,
    badge: null,
    video: null,
    used: false,
    rights: s.rights,
    target: { _tag: "Play", url: url(s.path) }
  }))

// Explore (decision 6): ElevenLabs' shared voices for narration (free samples), the songs and sounds that come with
// Viral, and the viral videos you kept to learn from.
export const exploreItems = (input: {
  readonly voices: ReadonlyArray<LibraryVoice>
  readonly tracks: ReadonlyArray<MusicTrack>
  readonly sounds: ReadonlyArray<SoundEffect>
  readonly references: ReadonlyArray<ReferenceVideo>
  // the short's song, marked as used
  readonly songId: string | null
  // songs can be picked (a narrated short)
  readonly songs: boolean
  readonly soundUrl: (path: string) => string
}): ReadonlyArray<TargetedItem> => [
  ...input.voices.map((v): TargetedItem => ({
    key: `explore-voice-${v.voiceId}`,
    type: "Voices",
    name: [v.name.split(" - ")[0] ?? v.name, v.description === null ? null : v.description.split(/[.,]/)[0]?.toLowerCase()].filter(Boolean).join(" · "),
    sub: `Shared · ${users(v.users)}`,
    picture: null,
    badge: v.inMyVoices ? "Yours" : null,
    video: null,
    used: false,
    rights: null,
    target: v.previewUrl === null ? { _tag: "None" } : { _tag: "Play", url: v.previewUrl }
  })),
  ...input.tracks.filter((t) => t.origin._tag === "Bundled").map((t): TargetedItem => ({
    key: `explore-track-${t.id}`,
    type: "Music",
    name: t.title,
    sub: `${t.bpm === null ? "Tempo not known yet" : `${Math.round(t.bpm)} BPM`} · free to use`,
    picture: null,
    badge: t.durationS === null ? null : clock(t.durationS),
    video: null,
    used: t.id === input.songId,
    rights: t.rights,
    target: input.songs ? { _tag: "Song", trackId: t.id } : { _tag: "None" }
  })),
  ...soundItems(input.sounds, true, input.soundUrl),
  ...input.references.map((r): TargetedItem => ({
    key: `explore-ref-${r.id}`,
    type: "References",
    name: r.title ?? r.url,
    sub: [r.creator, r.platform, r.durationS === null ? null : clock(r.durationS)].filter((x) => x !== null).join(" · ") || "Kept to learn from",
    picture: null,
    badge: null,
    video: null,
    used: false,
    rights: null,
    target: { _tag: "Link", url: r.url }
  }))
]
