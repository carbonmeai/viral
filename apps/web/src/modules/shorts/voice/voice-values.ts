import type { TranscriptWord } from "@viral/contracts"

// The waveform as `bars` heights between 0 and 1: the loudest sample in each slice, scaled to the loudest slice.
export const peaksOf = (samples: Float32Array, bars: number): ReadonlyArray<number> => {
  if (samples.length === 0 || bars <= 0) return []
  const size = Math.max(1, Math.floor(samples.length / bars))
  const raw: Array<number> = []
  for (let b = 0; b < bars; b++) {
    let max = 0
    const end = Math.min(samples.length, (b + 1) * size)
    for (let i = b * size; i < end; i++) {
      const v = Math.abs(samples[i]!)
      if (v > max) max = v
    }
    raw.push(max)
  }
  const top = Math.max(...raw, 1e-6)
  return raw.map((v) => v / top)
}

// The word being spoken at `t` (the last one started), or -1 before the first.
export const wordIndexAt = (words: ReadonlyArray<TranscriptWord>, t: number) => {
  let found = -1
  for (let i = 0; i < words.length; i++) {
    if (words[i]!.s <= t) found = i
    else break
  }
  return found
}
