import type { BackdropColor, FrameCrop, ThumbConfig, ThumbnailColor, ThumbnailProposal } from "@viral/contracts"
import type { Checked } from "../agent-session/run-checked.ts"
import { clipSource, sourceField } from "../projects/source-context.ts"

export type Range = { readonly start: number; readonly end: number }

// One of the videos a thumbnail can draw from.
export interface ThumbnailContext {
  // the source video's frame size, to turn fractional crops into the renderer's pixels
  readonly width: number
  readonly height: number
  readonly sourceSeconds: number
  readonly excluded: ReadonlyArray<Range>
}

const WORDS: readonly [number, number] = [2, 4]
// a bold thumbnail's tease can take one more word ("WORST CANDY EVER?")
const BOLD_WORDS: readonly [number, number] = [2, 5]
// longest line that still reads at a big size on a 1080px-wide thumbnail
const LINE_CHARS = 12
// smallest crop side, as a fraction of the frame: anything less is too soft once blown up
const MIN_CROP = 0.2
// the hero sits in a fixed slot 92% of the canvas wide; a crop much taller than wide would cover the text
// and the face, one much wider would leave it a thin strip
const HERO_ASPECT: readonly [number, number] = [0.9, 2.4]
const FACE_ASPECT: readonly [number, number] = [0.7, 2]
// bold cuts the subject out, so any reasonable shape works; the face is head and shoulders, about portrait
const BOLD_HERO_ASPECT: readonly [number, number] = [0.5, 2.6]
const BOLD_FACE_ASPECT: readonly [number, number] = [0.45, 1.5]

const COLORS: Record<ThumbnailColor, string> = { yellow: "#FFD400", white: "#FFFFFF", red: "#FF3B30" }
// bold gradients, centre colour then edge colour: saturated, so the outlined cut-outs and the text pop
const BACKDROPS: Record<BackdropColor, readonly [string, string]> = {
  red: ["#FF3B30", "#3A0000"],
  yellow: ["#FFE45C", "#FF7A00"],
  orange: ["#FFA53A", "#5A1A00"],
  blue: ["#3D8BFF", "#04102E"],
  purple: ["#6B4CFF", "#0B0630"],
  green: ["#3DDC6B", "#032B10"],
  pink: ["#FF5FB4", "#3A0020"]
}
// the bold layout, as tuned on the candy variations: a turned hero above centre, the face big and bleeding off
// its side and the bottom, the arrow or emoji on the empty side
const BOLD = {
  hero: { y: 0.47, width: 0.64, rotate: -7 },
  face: { height: 0.5 },
  faceX: { right: 0.74, left: 0.26 },
  sizes: [210, 220],
  emoji: { y: 0.78, size: 250 }
} as const
const EMOJI = /^\p{Extended_Pictographic}(\u{FE0F}|\u{200D}\p{Extended_Pictographic})*$/u

// the hand-made candy thumbnail's layout
const LAYOUT = {
  hero: { y: 0.45, width: 0.92 },
  face: { y: 0.79, x: 0.64, width: 0.58, tilt: -4 },
  sizes: [220, 180]
} as const

const fmt = (t: number) => t.toFixed(1)
const countWords = (text: string) => text.split(/\s+/).filter((w) => w !== "").length

// Checks a proposed thumbnail against the videos it can draw from (V1 first; each layer's `source` picks one):
// real moments outside the ads, crops inside the frame and in proportion with their slot, and 2–4 words that fit.
export const checkThumbnail = (proposal: ThumbnailProposal, sources: ReadonlyArray<ThumbnailContext>): Checked<ThumbnailProposal> => {
  const problems: Array<string> = []
  // the layer's video, or null (with a problem) when there's no such video
  const videoOf = (name: string, source: number | undefined) => {
    const video = clipSource(sources, source, name)
    if (video.problem !== null) problems.push(video.problem)
    return video.source
  }
  const moment = (name: string, src: number, ctx: ThumbnailContext) => {
    if (!(src >= 0 && src < ctx.sourceSeconds)) problems.push(`${name} at ${fmt(src)}s is outside the video (0–${fmt(ctx.sourceSeconds)}s)`)
    const ad = ctx.excluded.find((r) => src >= r.start && src <= r.end)
    if (ad !== undefined) problems.push(`${name} at ${fmt(src)}s is inside an excluded range (${fmt(ad.start)}–${fmt(ad.end)}s)`)
  }
  const crop = (name: string, [left, top, right, bottom]: FrameCrop, aspect: readonly [number, number], ctx: ThumbnailContext) => {
    if (!(left >= 0 && top >= 0 && right <= 1 && bottom <= 1 && left < right && top < bottom)) {
      return problems.push(`${name} crop [${[left, top, right, bottom].join(", ")}] must be fractions of the frame, left < right, top < bottom`)
    }
    if (right - left < MIN_CROP || bottom - top < MIN_CROP) {
      problems.push(`${name} crop is too small to stay sharp; keep each side at least ${MIN_CROP * 100}% of the frame`)
    }
    const ratio = ((right - left) * ctx.width) / ((bottom - top) * ctx.height)
    if (ratio < aspect[0] || ratio > aspect[1]) {
      problems.push(`${name} crop is ${ratio.toFixed(2)}:1 (width:height); its slot needs ${aspect[0]}–${aspect[1]}:1`)
    }
  }

  const bold = proposal.layout !== "classic"
  if (!bold) {
    const background = videoOf("the background", proposal.background.source)
    if (background !== null) moment("the background", proposal.background.src, background)
  }
  const hero = videoOf("the hero", proposal.hero.source)
  if (hero !== null) {
    moment("the hero", proposal.hero.src, hero)
    crop("the hero", proposal.hero.crop, bold ? BOLD_HERO_ASPECT : HERO_ASPECT, hero)
  }
  const circle = proposal.hero.circle
  if (circle !== null && !(circle.x >= 0 && circle.x <= 1 && circle.y >= 0 && circle.y <= 1 && circle.r >= 0.1 && circle.r <= 0.5)) {
    problems.push("the circle's x and y are fractions of the hero image (0–1), and r is 0.1–0.5")
  }
  if (proposal.face !== null) {
    const face = videoOf("the face", proposal.face.source)
    if (face !== null) {
      moment("the face", proposal.face.src, face)
      crop("the face", proposal.face.crop, bold ? BOLD_FACE_ASPECT : FACE_ASPECT, face)
    }
  } else if (bold) {
    problems.push("a bold thumbnail needs the video's strongest reaction face; use layout \"classic\" if it has none")
  }
  const emoji = proposal.emoji?.trim() ?? ""
  if (emoji !== "" && !EMOJI.test(emoji)) problems.push(`"${emoji}" isn't a single emoji`)

  const lines = proposal.lines.map((l) => ({ ...l, text: l.text.trim().toUpperCase() }))
  if (lines.length < 1 || lines.length > 2) problems.push(`use one or two lines of text, not ${lines.length}`)
  const words = lines.reduce((n, l) => n + countWords(l.text), 0)
  const range = bold ? BOLD_WORDS : WORDS
  if (words < range[0] || words > range[1]) problems.push(`the text is ${words} words; use ${range[0]}–${range[1]}`)
  for (const line of lines) {
    if (line.text === "") problems.push("a line of text is empty")
    else if (line.text.length > LINE_CHARS) problems.push(`"${line.text}" is ${line.text.length} characters; keep a line to ${LINE_CHARS} so it stays huge`)
  }
  // V1 is stored as before, without a source
  const { source: backgroundSource, ...background } = proposal.background
  const { source: heroSource, ...heroLayer } = proposal.hero
  const faceLayer = proposal.face === null ? null : (({ source, ...face }) => ({ ...face, ...sourceField(source) }))(proposal.face)
  return {
    value: {
      ...proposal,
      background: { ...background, ...sourceField(backgroundSource) },
      hero: { ...heroLayer, ...sourceField(heroSource) },
      face: faceLayer,
      lines,
      ...(proposal.emoji === undefined ? {} : { emoji: emoji === "" ? null : emoji })
    },
    problems
  }
}

const box = (crop: FrameCrop, width: number, height: number): readonly [number, number, number, number] => [
  Math.round(crop[0] * width),
  Math.round(crop[1] * height),
  Math.round(crop[2] * width),
  Math.round(crop[3] * height)
]

// The renderer's config for a checked proposal: the bold layout unless it asks for classic.
export const thumbConfig = (proposal: ThumbnailProposal, source: string, ctx: Pick<ThumbnailContext, "width" | "height">): ThumbConfig =>
  proposal.layout === "classic" ? classicConfig(proposal, source, ctx) : boldConfig(proposal, source, ctx)

const boldConfig = (proposal: ThumbnailProposal, source: string, ctx: Pick<ThumbnailContext, "width" | "height">): ThumbConfig => {
  const side = proposal.face?.side ?? "right"
  const emoji = proposal.emoji ?? null
  return {
    layout: "bold",
    source,
    background: { src: proposal.hero.src },
    backdrop: { colors: [...BACKDROPS[proposal.background.color ?? "red"]], burst: true },
    hero: {
      src: proposal.hero.src,
      box: box(proposal.hero.crop, ctx.width, ctx.height),
      x: 0.5,
      ...BOLD.hero,
      ...(proposal.hero.circle === null
        ? {}
        : { circle: true, circle_x: proposal.hero.circle.x, circle_y: proposal.hero.circle.y, circle_r: proposal.hero.circle.r })
    },
    ...(proposal.face === null ? {} : {
      inset: { src: proposal.face.src, box: box(proposal.face.crop, ctx.width, ctx.height), y: 1, ...BOLD.face, side, x: BOLD.faceX[side] }
    }),
    lines: proposal.lines.map((line, i) => ({ text: line.text, color: COLORS[line.color], size: BOLD.sizes[Math.min(i, 1)]! })),
    text_y: 0.025,
    arrow: proposal.arrow ?? emoji === null,
    ...(emoji === null ? {} : { emoji: { char: emoji, x: side === "right" ? 0.2 : 0.8, ...BOLD.emoji } })
  }
}

const classicConfig = (proposal: ThumbnailProposal, source: string, ctx: Pick<ThumbnailContext, "width" | "height">): ThumbConfig => ({
  source,
  background: { src: proposal.background.src },
  hero: {
    src: proposal.hero.src,
    box: box(proposal.hero.crop, ctx.width, ctx.height),
    ...LAYOUT.hero,
    ...(proposal.hero.circle === null
      ? { circle: false }
      : { circle: true, circle_x: proposal.hero.circle.x, circle_y: proposal.hero.circle.y, circle_r: proposal.hero.circle.r })
  },
  ...(proposal.face === null ? {} : {
    inset: { src: proposal.face.src, box: box(proposal.face.crop, ctx.width, ctx.height), ...LAYOUT.face }
  }),
  lines: proposal.lines.map((line, i) => ({ text: line.text, color: COLORS[line.color], size: LAYOUT.sizes[Math.min(i, 1)]! })),
  arrow: false
})

// Checks a config you edited at the gate: real moments outside the ads, pixel crops inside the frame, and
// 2–4 words of text.
export const checkConfig = (config: ThumbConfig, ctx: ThumbnailContext): ReadonlyArray<string> => {
  const problems: Array<string> = []
  const moments: Array<readonly [string, number]> = [["the background", config.background.src], ["the hero", config.hero.src]]
  if (config.inset !== undefined) moments.push(["the face", config.inset.src])
  for (const [name, src] of moments) {
    if (!(src >= 0 && src < ctx.sourceSeconds)) problems.push(`${name} at ${fmt(src)}s is outside the video (0–${fmt(ctx.sourceSeconds)}s)`)
    if (ctx.excluded.some((r) => src >= r.start && src <= r.end)) problems.push(`${name} at ${fmt(src)}s is inside an excluded range`)
  }
  const boxes: Array<readonly [string, readonly [number, number, number, number] | undefined]> = [["the hero", config.hero.box], ["the face", config.inset?.box]]
  for (const [name, b] of boxes) {
    if (b !== undefined && !(b[0] >= 0 && b[1] >= 0 && b[2] <= ctx.width && b[3] <= ctx.height && b[0] < b[2] && b[1] < b[3])) {
      problems.push(`${name} box [${b.join(", ")}] must be inside the ${ctx.width}×${ctx.height} frame`)
    }
  }
  const words = config.lines.reduce((n, l) => n + countWords(l.text), 0)
  // a bold thumbnail's tease can take one more word, as when it's proposed
  const [min, max] = config.layout === "bold" ? BOLD_WORDS : WORDS
  if (words < min || words > max) problems.push(`the text is ${words} words; use ${min}–${max}`)
  return problems
}
