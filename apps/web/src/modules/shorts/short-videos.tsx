import { createContext, type ReactNode, useContext } from "react"
import { videoLabel, videoNames } from "../sets/set-values.ts"

// The short's videos as its editor names them, by position: each one's short name and full title.
export interface ShortVideos {
  readonly names: ReadonlyArray<string>
  readonly titles: ReadonlyArray<string | null>
}

const Context = createContext<ShortVideos>({ names: [], titles: [] })

export function ShortVideosProvider({ titles, children }: { readonly titles: ReadonlyArray<string | null>; readonly children: ReactNode }) {
  return <Context.Provider value={{ names: videoNames(titles), titles }}>{children}</Context.Provider>
}

export const useShortVideos = () => useContext(Context)

// A video's short name by position ("Heidi Klum"), "Video 2" when the editor doesn't know it.
export const nameOf = (videos: ShortVideos, index: number) => videos.names[index] ?? videoLabel(index)
