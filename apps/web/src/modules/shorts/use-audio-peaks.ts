import { useEffect, useState } from "react"

// How finely a file's waveform is kept: the loudest sample in each fiftieth of a second.
export const PEAKS_PER_SECOND = 50

// Peaks by file, decoded once per page: a voiceover take or a bed has a new file (and url) when it changes, so the
// timeline doesn't decode the same take again on every open.
const decoded = new Map<string, Promise<ReadonlyArray<number>>>()

const decode = (url: string) => {
  const known = decoded.get(url)
  if (known !== undefined) return known
  const context = new AudioContext()
  const peaks = fetch(url)
    .then((res) => res.arrayBuffer())
    .then((bytes) => context.decodeAudioData(bytes))
    .then((buffer) => {
      const samples = buffer.getChannelData(0)
      const size = Math.max(1, Math.round(buffer.sampleRate / PEAKS_PER_SECOND))
      const raw: Array<number> = []
      for (let at = 0; at < samples.length; at += size) {
        let max = 0
        const end = Math.min(samples.length, at + size)
        for (let i = at; i < end; i++) {
          const v = Math.abs(samples[i]!)
          if (v > max) max = v
        }
        raw.push(max)
      }
      const top = Math.max(...raw, 1e-6)
      return raw.map((v) => v / top)
    })
    .finally(() => void context.close())
  // a failed decode can be tried again on the next open
  peaks.catch(() => decoded.delete(url))
  decoded.set(url, peaks)
  return peaks
}

// A file's waveform, PEAKS_PER_SECOND values a second between 0 and 1; null while it decodes, empty if it couldn't.
export function useAudioPeaks(url: string | null): ReadonlyArray<number> | null {
  const [peaks, setPeaks] = useState<{ readonly url: string; readonly peaks: ReadonlyArray<number> } | null>(null)
  useEffect(() => {
    if (url === null) return
    let live = true
    decode(url)
      .then((p) => live && setPeaks({ url, peaks: p }))
      .catch(() => live && setPeaks({ url, peaks: [] }))
    return () => {
      live = false
    }
  }, [url])
  return url === null ? [] : peaks?.url === url ? peaks.peaks : null
}
