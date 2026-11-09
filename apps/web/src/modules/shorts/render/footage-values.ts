import type { RenderFootage } from "@viral/contracts"

export interface FootageLine {
  // "V2 · Blind cow" (just the title in a short from one video)
  readonly video: string
  // "1080p · 4 clips" or "480p reading copy · 3 of 3 clips"
  readonly quality: string
  // why any clip played from the reading copy, in plain words; null when none did
  readonly problem: string | null
}

// The render gate's footage rows for videos found by research: they were read from 480p copies, and only the seconds
// the short plays were fetched in 1080p. A clip that couldn't be is said plainly, never hidden.
export const footageLines = (footage: ReadonlyArray<RenderFootage>, several: boolean): ReadonlyArray<FootageLine> =>
  footage.map((f) => {
    const name = f.title ?? "Untitled video"
    const total = f.clips + f.scanClips
    const clips = (n: number) => `${n} ${n === 1 ? "clip" : "clips"}`
    return {
      video: several ? `V${f.video + 1} · ${name}` : name,
      quality: f.scanClips === 0
        ? `${f.height ?? 1080}p · ${clips(f.clips)}`
        : `${f.scanHeight ?? 480}p reading copy · ${f.scanClips === total ? clips(total) : `${f.scanClips} of ${clips(total)}`}`,
      problem: f.scanClips === 0 ? null : f.problem ?? "its 1080p pieces didn't cover them"
    }
  })

// The block's short summary: "All 1080p" when every clip played from pieces, else how many videos fell back.
export const footageSummary = (footage: ReadonlyArray<RenderFootage>): string => {
  const low = footage.filter((f) => f.scanClips > 0).length
  return low === 0 ? "All 1080p" : `${low} of ${footage.length} ${footage.length === 1 ? "video" : "videos"} in 480p`
}
