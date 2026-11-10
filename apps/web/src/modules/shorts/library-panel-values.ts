import type { Rights } from "@viral/contracts"

// The Library panel's tabs: this short's own things, everything in your library, and things to explore.
export type LibraryTab = "short" | "library" | "explore"
export type LibraryType = "All" | "Videos" | "Frames" | "Clips" | "Music" | "Voice"
export const LIBRARY_TYPES: ReadonlyArray<LibraryType> = ["All", "Videos", "Frames", "Clips", "Music", "Voice"]

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
export const typesOf = (items: ReadonlyArray<LibraryItem>): ReadonlyArray<LibraryType> =>
  LIBRARY_TYPES.filter((t) => t === "All" || items.some((i) => i.type === t))

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
