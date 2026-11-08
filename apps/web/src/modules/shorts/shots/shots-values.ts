import type { PlannedShot, ShotPlan, ShotProposal, TranscriptWord } from "@viral/contracts"
import type { TimelineLayout } from "../editor-values.ts"

// What you changed about one shot before sending the edit: a new frame (its source second, the still that shows
// it, and which video it's from when you picked one from another video), framing, crop or speed. Anything left out
// stays as planned.
export interface ShotChange {
  readonly src?: number
  // the video the new frame is from, by position (the first = 0)
  readonly source?: number
  // the picked still, relative to its video's folder (frames-around/<ms>.jpg)
  readonly still?: string
  readonly fit?: boolean
  readonly cropX?: number
  readonly speed?: number
}
export type ShotDraft = ReadonlyMap<number, ShotChange>

// A shot as it stands with your changes on top.
export const shotWith = (shot: ShotPlan["shots"][number], change: ShotChange | undefined) => ({
  ...shot,
  ...(change?.src === undefined ? {} : { src: change.src }),
  ...(change?.source === undefined ? {} : { source: change.source }),
  ...(change?.fit === undefined ? {} : { fit: change.fit }),
  ...(change?.cropX === undefined ? {} : { cropX: change.cropX }),
  ...(change?.speed === undefined ? {} : { speed: change.speed })
})

// How many shots differ from the plan.
export const changedShots = (plan: ShotPlan, draft: ShotDraft) =>
  [...draft.entries()].filter(([k, change]) => {
    const shot = plan.shots[k]
    if (shot === undefined) return false
    const next = shotWith(shot, change)
    return next.src !== shot.src || (next.source ?? 0) !== (shot.source ?? 0) || (next.fit ?? false) !== (shot.fit ?? false) || next.cropX !== shot.cropX || (next.speed ?? 1) !== (shot.speed ?? 1)
  }).length

// The edited shot list the shots gate takes: every shot with your changes, the markers and highlights as planned.
export const proposalOf = (plan: ShotPlan, draft: ShotDraft): ShotProposal => ({
  shots: plan.shots.map((shot, k): PlannedShot => {
    const s = shotWith(shot, draft.get(k))
    return {
      word: s.word,
      src: s.src,
      // the first video is left out, as the server stores it
      ...((s.source ?? 0) === 0 ? {} : { source: s.source }),
      note: s.note,
      ...(s.fit === undefined ? {} : { fit: s.fit }),
      ...(s.cropX === undefined ? {} : { cropX: s.cropX }),
      ...(s.speed === undefined || s.speed === 1 ? {} : { speed: s.speed })
    }
  }),
  markers: plan.markers,
  highlights: plan.highlights
})

// Where each shot plays on the voiceover: from its word (the first shot from 0) to the next shot's word, the last
// one to the end of the voiceover.
export const shotSpans = (plan: Pick<ShotPlan, "shots">, words: ReadonlyArray<TranscriptWord>, voiceoverSeconds: number) =>
  plan.shots.map((shot, k) => {
    const from = shot.word === 0 ? 0 : words[shot.word]?.s ?? 0
    const nextShot = plan.shots[k + 1]
    const to = nextShot === undefined ? voiceoverSeconds : words[nextShot.word]?.s ?? voiceoverSeconds
    return { k, from, to: Math.max(from, to) }
  })

export interface ShotBlock {
  readonly k: number
  readonly start: number
  readonly end: number
}

// The shots on the short's own timeline: a shot that a real line interrupts shows as two pieces, with the real
// line playing in between, as the renderer cuts it.
export const timelineShots = (
  spans: ReadonlyArray<{ readonly k: number; readonly from: number; readonly to: number }>,
  layout: Pick<TimelineLayout, "pauses">
): ReadonlyArray<ShotBlock> => {
  const before = (t: number) => layout.pauses.filter((p) => p.at < t).reduce((n, p) => n + p.dur, 0)
  return spans.flatMap(({ k, from, to }) => {
    const cuts = layout.pauses.map((p) => p.at).filter((at) => at > from && at < to)
    const edges = [from, ...cuts, to]
    return edges.slice(0, -1).map((start, i): ShotBlock => {
      const end = edges[i + 1]!
      // a piece that starts at a pause comes after the real line that plays there
      const shift = before(start) + (i > 0 ? layout.pauses.filter((p) => p.at === start).reduce((n, p) => n + p.dur, 0) : 0)
      return { k, start: start + shift, end: end + shift }
    }).filter((b) => b.end - b.start > 0.01)
  })
}

export type StoryboardItem =
  | { readonly _tag: "Shot"; readonly k: number }
  | { readonly _tag: "Real"; readonly kind: "insert" | "outro"; readonly index: number }

// The storyboard's tiles in playing order: the shots, each real line where it cuts in (after the narration word
// before it), then the outro clips.
export const storyboardOrder = (plan: Pick<ShotPlan, "shots" | "inserts" | "outro">): ReadonlyArray<StoryboardItem> => {
  const items: Array<StoryboardItem> = []
  let insert = 0
  plan.shots.forEach((shot, k) => {
    while (plan.inserts[insert] !== undefined && plan.inserts[insert]!.afterWord < shot.word) {
      items.push({ _tag: "Real", kind: "insert", index: insert++ })
    }
    items.push({ _tag: "Shot", k })
  })
  for (; insert < plan.inserts.length; insert++) items.push({ _tag: "Real", kind: "insert", index: insert })
  plan.outro.forEach((_, index) => items.push({ _tag: "Real", kind: "outro", index }))
  return items
}

// "33:34" for a source second.
export const mmss = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

// The plan's highlight words, as plain lowercase words.
export const highlightWords = (plan: Pick<ShotPlan, "highlights">) =>
  new Set(plan.highlights.map((h) => (typeof h === "string" ? h : h.word).toLowerCase()))

// A headline line's size as a share of the width, as the renderer draws it: the first line up to the style's
// size, the others up to 60% of it, each shrunk until it fits 90% of the width (a condensed face's letters are
// about half an em wide).
export const headlineSize = (line: string, index: number, size: number) =>
  Math.min(size * 100 * (index === 0 ? 1 : 0.6), 90 / (Math.max(1, line.length) * 0.48))
