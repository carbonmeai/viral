import { createContext, type ReactNode, useContext } from "react"
import { sourceNames, videoLabel } from "../sets/set-values.ts"

// The short's videos as its editor names them, by position: each one's short name and full title.
export interface ShortVideos {
  readonly names: ReadonlyArray<string>
  readonly titles: ReadonlyArray<string | null>
}

const Context = createContext<ShortVideos>({ names: [], titles: [] })

// `sources`: the short's videos, V1 first; each goes by the short name you gave it, else one made from its title.
export function ShortVideosProvider({ sources, children }: {
  readonly sources: ReadonlyArray<{ readonly title: string | null; readonly shortName: string | null }>
  readonly children: ReactNode
}) {
  return <Context.Provider value={{ names: sourceNames(sources), titles: sources.map((s) => s.title) }}>{children}</Context.Provider>
}

export const useShortVideos = () => useContext(Context)

// A video's short name by position ("Heidi Klum"), "Video 2" when the editor doesn't know it.
export const nameOf = (videos: ShortVideos, index: number) => videos.names[index] ?? videoLabel(index)
