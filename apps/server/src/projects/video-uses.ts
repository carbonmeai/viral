import type { CutPlan, RankingPlan, Script, ShotPlan, Thumbnail } from "@viral/contracts"

// A short's current work, as far as its videos go: the latest script, shot plan, sections and thumbnail (absent
// when there's none yet).
export interface ShortWork {
  readonly script?: Script | null
  readonly shotPlan?: ShotPlan | null
  readonly cutPlan?: CutPlan | null
  readonly rankingPlan?: RankingPlan | null
  readonly thumbnail?: Thumbnail | null
}

// The steps whose work names videos, in the order a short runs them.
export type VideoStep = "script" | "shots" | "sections" | "moments" | "thumbnail"
const STEP_NAMES: Record<VideoStep, string> = {
  script: "the script",
  shots: "the shots",
  sections: "the sections",
  moments: "the ranking",
  thumbnail: "the thumbnail"
}

// Which steps use each of the short's videos (by position, V1 = 0): a real line, a shot or real clip, a section, a
// thumbnail layer. A video no step uses has no entry.
export const videoUses = (work: ShortWork): ReadonlyMap<number, ReadonlyArray<VideoStep>> => {
  const uses = new Map<number, Array<VideoStep>>()
  const add = (step: VideoStep, source: number | undefined) => {
    const index = source ?? 0
    const steps = uses.get(index) ?? []
    if (!steps.includes(step)) steps.push(step)
    uses.set(index, steps)
  }
  for (const beat of work.script?.beats ?? []) if (beat._tag === "Real") add("script", beat.source)
  const plan = work.shotPlan
  if (plan !== null && plan !== undefined) for (const clip of [...plan.shots, ...plan.inserts, ...plan.outro]) add("shots", clip.source)
  for (const section of work.cutPlan?.sections ?? []) add("sections", section.source)
  for (const entry of work.rankingPlan?.entries ?? []) add("moments", entry.source)
  const thumbnail = work.thumbnail?.config
  if (thumbnail !== undefined) {
    if (thumbnail.layout !== "bold") add("thumbnail", thumbnail.background.source)
    add("thumbnail", thumbnail.hero.source)
    if (thumbnail.inset !== undefined) add("thumbnail", thumbnail.inset.source)
  }
  return uses
}

const and = (names: ReadonlyArray<string>) => names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`

// "the script and the shots"
export const stepList = (steps: ReadonlyArray<VideoStep>) => and(steps.map((s) => STEP_NAMES[s]))
// "the script uses", "the shots use"
const stepsUse = (steps: ReadonlyArray<VideoStep>) =>
  `${stepList(steps)} ${steps.length > 1 || steps[0] === "shots" || steps[0] === "sections" ? "use" : "uses"}`

// Why the video at `index` can't leave the short, or null when it can: a step's current work uses it, or uses a
// video after it (clips name their video by its place, which would move). `names` are the videos' names, by
// position.
export const removalProblem = (work: ShortWork, index: number, names: ReadonlyArray<string>): string | null => {
  const uses = videoUses(work)
  const own = uses.get(index)
  const name = names[index] ?? `video ${index + 1}`
  if (own !== undefined) {
    return `"${name}" can't be removed: ${stepsUse(own)} it. ` +
      `Change ${own.length === 1 ? "that step" : "those steps"} so ${own.length === 1 ? "it doesn't" : "they don't"} use it first.`
  }
  const later = [...uses.keys()].filter((i) => i > index).sort((a, b) => a - b)[0]
  if (later !== undefined) {
    const steps = uses.get(later)!
    return `"${name}" can't be removed while ${stepsUse(steps)} "${names[later] ?? `video ${later + 1}`}", ` +
      `which was added after it.`
  }
  return null
}
