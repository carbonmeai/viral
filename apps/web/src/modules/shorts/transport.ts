import { useEffect, useRef } from "react"

// The open step's player as the timeline drives it: play/pause, and jump to a moment of the short (its own seconds).
export interface Transport {
  readonly toggle: () => void
  readonly seek: (shortSeconds: number) => void
}

// How a player hands itself to the editor: `attach` while it's shown (null when it goes), `playing` as it starts and
// stops, so the timeline's play button follows it.
export interface TransportLink {
  readonly attach: (transport: Transport | null) => void
  readonly playing: (playing: boolean) => void
}

// Hands the player's controls to the timeline for as long as the player is shown (always its latest toggle and seek).
export function useTransport(link: TransportLink | undefined, toggle: () => void, seek: (shortSeconds: number) => void, playing: boolean) {
  const latest = useRef({ toggle, seek })
  latest.current = { toggle, seek }
  useEffect(() => {
    if (link === undefined) return
    link.attach({ toggle: () => latest.current.toggle(), seek: (t) => latest.current.seek(t) })
    return () => link.attach(null)
  }, [link])
  useEffect(() => {
    link?.playing(playing)
  }, [link, playing])
}
