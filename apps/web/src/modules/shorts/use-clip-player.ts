import { useCallback, useEffect, useRef, useState } from "react"

// Plays one stretch of a media file at a time (a real line from the long video), then stops at its end. Starting
// another stretch, or the same one again, stops the first. A stretch can come from another file (`from`: a real
// line from another of the short's videos).
export function useClipPlayer(src: string | null) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)

  useEffect(() => () => audio.current?.pause(), [])

  const stop = useCallback(() => {
    audio.current?.pause()
    setPlaying(null)
  }, [])

  const play = useCallback((key: string, start: number, end: number, from?: string | null) => {
    const file = from === undefined ? src : from
    if (file === null) return
    if (playing === key) return stop()
    const el = audio.current ?? new Audio()
    audio.current = el
    if (el.src !== file) el.src = file
    el.ontimeupdate = () => {
      if (el.currentTime >= end) stop()
    }
    el.onended = stop
    el.currentTime = start
    setPlaying(key)
    void el.play().catch(() => setPlaying(null))
  }, [src, playing, stop])

  return { playing, play, stop }
}
