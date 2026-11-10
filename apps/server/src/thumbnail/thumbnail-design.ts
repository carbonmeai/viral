import type { ProposedThumbnailDesign, RankingPlan, ThumbnailDesign, ThumbnailPick } from "@viral/contracts"
import type { Checked } from "../agent-session/run-checked.ts"
import { clipSource, sourceField, sourceLabel } from "../projects/source-context.ts"
import { rankingMoments } from "./ranking-thumbnail.ts"
import type { ThumbnailContext } from "./thumbnail-rules.ts"

// An AI thumbnail's design (the short-thumbnail skill): which real frames go to the image model and what the four
// bands say. The server checks it, numbers the frames (reactions first, then the hero, then the graphic, the order
// the skill's approved prompt used) and writes the prompt from the skill's template.

const WORDS: readonly [number, number] = [1, 3]
// "LEVEL 10", "$10,000", "TOP 1": longer stops reading as one huge line
const WORDS_CHARS = 18
const REACTIONS: readonly [number, number] = [2, 3]
// two reactions from the same second of the same video are one reaction
const REACTION_GAP = 0.5

const fmt = (t: number) => t.toFixed(1)
const countWords = (text: string) => text.split(/\s+/).filter((w) => w !== "").length

// The agent's design as it's stored: each frame's V number becomes its position (V1 = 0, left out for V1).
export const fromProposedDesign = (proposed: ProposedThumbnailDesign): ThumbnailDesign => {
  const frame = <F extends { readonly video?: number }>({ video, ...rest }: F): Omit<F, "video"> & { readonly source?: number } => ({
    ...rest,
    ...sourceField(video === undefined ? undefined : video - 1)
  })
  return {
    ...proposed,
    graphic: proposed.graphic === null ? null : frame(proposed.graphic),
    hero: frame(proposed.hero),
    reactions: proposed.reactions.map(frame)
  }
}

// One frame the image model gets, in prompt order (image 1, 2…).
export interface DesignInput {
  readonly role: "reaction" | "hero" | "graphic"
  readonly src: number
  readonly source?: number
  readonly what: string
}

export const designInputs = (design: ThumbnailDesign): ReadonlyArray<DesignInput> => [
  ...design.reactions.map((r): DesignInput => ({ role: "reaction", src: r.src, ...sourceField(r.source), what: r.look })),
  { role: "hero", src: design.hero.src, ...sourceField(design.hero.source), what: design.hero.what },
  ...(design.graphic === null ? [] : [{ role: "graphic", src: design.graphic.src, ...sourceField(design.graphic.source), what: design.graphic.what } satisfies DesignInput])
]

// Checks a design against the short's videos: real moments inside each video and outside its ads, two or three
// distinct reactions, 1–3 words that read as one huge line, and every band described.
export const checkDesign = (design: ThumbnailDesign, sources: ReadonlyArray<ThumbnailContext>): Checked<ThumbnailDesign> => {
  const problems: Array<string> = []
  const several = sources.length > 1
  const named = (name: string, source: number | undefined) => several ? `${name} (${sourceLabel(source ?? 0)})` : name
  const moment = (name: string, src: number, source: number | undefined) => {
    const video = clipSource(sources, source, name)
    if (video.problem !== null) return problems.push(video.problem)
    const ctx = video.source
    const label = named(name, source)
    if (!(src >= 0 && src < ctx.sourceSeconds)) problems.push(`${label} at ${fmt(src)}s is outside the video (0–${fmt(ctx.sourceSeconds)}s)`)
    const ad = ctx.excluded.find((r) => src >= r.start && src <= r.end)
    if (ad !== undefined) problems.push(`${label} at ${fmt(src)}s is inside an excluded range (${fmt(ad.start)}–${fmt(ad.end)}s)`)
  }
  const said = (name: string, text: string) => {
    if (text.trim() === "") problems.push(`describe ${name}`)
  }

  const words = countWords(design.words)
  if (words < WORDS[0] || words > WORDS[1]) problems.push(`the words are ${WORDS[0]}–${WORDS[1]} words ("LEVEL 10", "TOP 1"); "${design.words}" has ${words}`)
  else if (design.words.trim().length > WORDS_CHARS) problems.push(`"${design.words.trim()}" is too long to read as one huge line; keep it to ${WORDS_CHARS} characters`)

  if (design.reactions.length < REACTIONS[0] || design.reactions.length > REACTIONS[1]) {
    problems.push(`use ${REACTIONS[0]}–${REACTIONS[1]} real reactions side by side; there are ${design.reactions.length}`)
  }
  design.reactions.forEach((r, i) => {
    moment(`reaction ${i + 1}`, r.src, r.source)
    said(`what reaction ${i + 1}'s face is doing`, r.look)
    const twin = design.reactions.findIndex((o, j) => j < i && (o.source ?? 0) === (r.source ?? 0) && Math.abs(o.src - r.src) < REACTION_GAP)
    if (twin >= 0) problems.push(`reactions ${twin + 1} and ${i + 1} are the same moment; pick two contrasting reactions`)
  })
  moment("the hero", design.hero.src, design.hero.source)
  said("the hero", design.hero.what)
  said("how the hero is made dramatic", design.hero.dramatise)
  if (design.graphic !== null) {
    moment("the graphic", design.graphic.src, design.graphic.source)
    said("the graphic", design.graphic.what)
  }
  said("how the person looks (face, hair, clothes)", design.person)
  said("the background", design.background)
  return { value: design, problems }
}

// A ranking's design: #1's real before and after frames are among the reactions or the hero, from #1's video.
export const rankingDesignBrief = (plan: RankingPlan, several: boolean) => {
  const moments = rankingMoments(plan)
  if (moments === null) return ""
  const video = several ? `V${moments.source + 1} ` : ""
  const ranges = (shots: typeof moments.after) => shots.map((s) => `${video}${fmt(s.start)}–${fmt(s.end)}s`).join(" or ")
  return [
    `This short is a ranking of ${plan.entries.length}: "${plan.title.lead}${plan.title.accent}", #1 is "${moments.entry.label}".`,
    `Follow the skill's ranking adaptation: the words are "TOP 1" (or "TOP ${plan.entries.length}"), and the bottom band shows #1's real BEFORE ` +
    `(${ranges(moments.before)}) and AFTER (${ranges(moments.after)}) side by side as the two "reactions"` +
    `${several ? ` (video: ${moments.source + 1})` : ""}. Make sure the after frame isn't a replay of the before.`
  ].join("\n")
}

const ORDINAL = ["", "once", "TWICE", "THREE TIMES"]
const SIDE = [["Left"], ["Left", "Right"], ["Left", "Middle", "Right"]] as const
const numbers = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i)
const list = (ns: ReadonlyArray<number>) => ns.length === 1 ? `${ns[0]}` : `${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}`
const sentence = (text: string) => {
  const t = text.trim()
  return /[.!?]$/.test(t) ? t : `${t}.`
}

// The image model's prompt, from the skill's verbatim template (thumbnails.md §1): images numbered, the four bands
// top to bottom, "copy faces photographically … do not redraw", and the big text kept clear of the hero.
export const buildImagePrompt = (design: ThumbnailDesign): string => {
  const reactions = design.reactions.length
  const faces = numbers(1, reactions)
  const heroImage = reactions + 1
  const graphicImage = design.graphic === null ? null : reactions + 2
  const words = design.words.trim().toUpperCase()
  const intro = [
    `Create a vertical 9:16 YouTube Shorts thumbnail. Images ${list(faces)} are REAL video frames of the same real person (${design.person.trim()}).`,
    `Image ${heroImage} is the real ${design.hero.what.trim()}.`,
    graphicImage === null ? null : `Image ${graphicImage} is the real ${design.graphic!.what.trim()}.`
  ].filter((x) => x !== null).join(" ")
  const bands = [
    graphicImage === null ? null : `Very top: the ${design.graphic!.what.trim()} from image ${graphicImage} reproduced faithfully, full width, with its own labels.`,
    `${graphicImage === null ? "Top" : "Below it"}: huge bold white "${words}" text with a thick black outline. The big text sits fully above the hero; nothing overlaps the letters.`,
    `Middle: the ${design.hero.what.trim()} from image ${heroImage}, huge, ${design.hero.dramatise.trim().replace(/\.$/, "")}.` +
    (design.escalation === null || design.escalation.trim() === "" ? "" : ` Under it a row of ${design.escalation.trim().replace(/\.$/, "")}.`),
    `Bottom: the real person ${ORDINAL[reactions]}, side by side, big. ` +
    design.reactions.map((r, i) => `${SIDE[reactions - 1]![i]} = the person exactly as in image ${i + 1} (${r.look.trim().replace(/\.$/, "")}).`).join(" ") +
    ` Copy ${reactions === 2 ? "both faces" : "every face"} photographically from images ${list(faces)} — identical face shape, skin, hair and clothes; do not invent, redraw or exaggerate the face.` +
    (design.prop === null || design.prop.trim() === "" ? "" : ` ${sentence(`${design.prop.trim().replace(/^./, (c) => c.toUpperCase())} between them`)}`)
  ].filter((x) => x !== null)
  return [
    intro,
    "",
    "Layout top to bottom, filling the frame with no empty space:",
    ...bands.map((b, i) => `${i + 1}. ${b}`),
    "",
    `${sentence(`${design.background.trim().replace(/^./, (c) => c.toUpperCase())} background, MrBeast / Nick DiGiovanni thumbnail style`)} No other text, no logos.`
  ].join("\n")
}

// Checks the agent's pick against the round it made: a check per option, and a recommendation that has an image.
export const checkPick = (pick: ThumbnailPick, options: ReadonlyArray<{ readonly image: string | null }>): Checked<ThumbnailPick> => {
  const problems: Array<string> = []
  const made = options.flatMap((o, i) => o.image === null ? [] : [i + 1])
  for (const c of pick.checks) {
    if (!made.includes(c.option)) problems.push(`option ${c.option} isn't one of the images made (${made.length === 0 ? "none were" : list(made)})`)
    if (!(c.faces >= 0 && c.faces <= 10)) problems.push(`option ${c.option}'s face score is 0–10`)
  }
  const missing = made.filter((n) => !pick.checks.some((c) => c.option === n))
  if (missing.length > 0) problems.push(`check option${missing.length === 1 ? "" : "s"} ${list(missing)} too`)
  if (pick.recommended !== null && !made.includes(pick.recommended)) problems.push(`recommend one of the images made (${list(made)}), or null`)
  return { value: pick, problems }
}
