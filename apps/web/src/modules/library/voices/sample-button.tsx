import { IconButton } from "@viral/ui/primitives/button"
import { AudioLines, Pause } from "lucide-react"
import { useEffect, useRef, useState } from "react"

// ElevenLabs' own sample of a voice, free to play. Only one plays at a time across the page.
let playingNow: HTMLAudioElement | null = null

export function SampleButton({ url, name }: { readonly url: string | null; readonly name: string }) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => () => audio.current?.pause(), [])
  if (url === null) return null
  const toggle = () => {
    if (audio.current === null) {
      audio.current = new Audio(url)
      audio.current.onended = () => setPlaying(false)
      audio.current.onpause = () => setPlaying(false)
    }
    if (playing) {
      audio.current.pause()
      return
    }
    if (playingNow !== null && playingNow !== audio.current) playingNow.pause()
    playingNow = audio.current
    void audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }
  return (
    <IconButton label={playing ? `Stop ${name}'s sample` : `Play ${name}'s free sample`} onClick={toggle} className={playing ? "text-lemon-fg" : ""}>
      {playing ? <Pause /> : <AudioLines />}
    </IconButton>
  )
}
