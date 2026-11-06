import type { FrameCrop, ThumbConfig, ThumbnailColor, ThumbnailProposal } from "@viral/contracts"
import type { Checked } from "../agent-session/run-checked.ts"

export type Range = { readonly start: number; readonly end: number }

export interface ThumbnailContext {
  // the source video's frame size, to turn fractional crops into the renderer's pixels
  readonly width: number
  readonly height: number
  readonly sourceSeconds: number
  readonly excluded: ReadonlyArray<Range>
}

const WORDS: readonly [number, number] = [2, 4]
// longest line that still reads at a big size on a 1080px-wide thumbnail
const LINE_CHARS = 12
// smallest crop side, as a fraction of the frame: anything less is too soft once blown up
const MIN_CROP = 0.2
// the hero sits in a fixed slot 92% of the canvas wide; a crop much taller than wide would cover the text
// and the face, one much wider would leave it a thin strip
const HERO_ASPECT: readonly [number, number] = [0.9, 2.4]
const FACE_ASPECT: readonly [number, number] = [0.7, 2]

const COLORS: Record<ThumbnailColor, string> = { yellow: "#FFD400", white: "#FFFFFF", red: "#FF3B30" }
// the hand-made candy thumbnail's layout
const LAYOUT = {
  hero: { y: 0.45, width: 0.92 },
  face: { y: 0.79, x: 0.64, width: 0.58, tilt: -4 },
  sizes: [220, 180]
} as const

const fmt = (t: number) => t.toFixed(1)
const countWords = (text: string) => text.split(/\s+/).filter((w) => w !== "").length

// Checks a proposed thumbnail against the video: real moments outside the ads, crops inside the frame and in
// proportion with their slot, and 2–4 words that fit.
export const checkThumbnail = (proposal: ThumbnailProposal, ctx: ThumbnailContext): Checked<ThumbnailProposal> => {
  const problems: Array<string> = []
  const moment = (name: string, src: number) => {
    if (!(src >= 0 && src < ctx.sourceSeconds)) problems.push(`${name} at ${fmt(src)}s is outside the video (0–${fmt(ctx.sourceSeconds)}s)`)
    const ad = ctx.excluded.find((r) => src >= r.start && src <= r.end)
    if (ad !== undefined) problems.push(`${name} at ${fmt(src)}s is inside an excluded range (${fmt(ad.start)}–${fmt(ad.end)}s)`)
  }
  const crop = (name: string, [left, top, right, bottom]: FrameCrop, aspect: readonly [number, number]) => {
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

  moment("the background", proposal.background.src)
  moment("the hero", proposal.hero.src)
  crop("the hero", proposal.hero.crop, HERO_ASPECT)
  const circle = proposal.hero.circle
  if (circle !== null && !(circle.x >= 0 && circle.x <= 1 && circle.y >= 0 && circle.y <= 1 && circle.r >= 0.1 && circle.r <= 0.5)) {
    problems.push("the circle's x and y are fractions of the hero image (0–1), and r is 0.1–0.5")
  }
  if (proposal.face !== null) {
    moment("the face", proposal.face.src)
    crop("the face", proposal.face.crop, FACE_ASPECT)
  }

  const lines = proposal.lines.map((l) => ({ ...l, text: l.text.trim().toUpperCase() }))
  if (lines.length < 1 || lines.length > 2) problems.push(`use one or two lines of text, not ${lines.length}`)
  const words = lines.reduce((n, l) => n + countWords(l.text), 0)
  if (words < WORDS[0] || words > WORDS[1]) problems.push(`the text is ${words} words; use ${WORDS[0]}–${WORDS[1]}`)
  for (const line of lines) {
    if (line.text === "") problems.push("a line of text is empty")
    else if (line.text.length > LINE_CHARS) problems.push(`"${line.text}" is ${line.text.length} characters; keep a line to ${LINE_CHARS} so it stays huge`)
  }
  return { value: { ...proposal, lines }, problems }
}

const box = (crop: FrameCrop, width: number, height: number): readonly [number, number, number, number] => [
  Math.round(crop[0] * width),
  Math.round(crop[1] * height),
  Math.round(crop[2] * width),
  Math.round(crop[3] * height)
]

// The renderer's config for a checked proposal, in the fixed layout.
export const thumbConfig = (proposal: ThumbnailProposal, source: string, ctx: Pick<ThumbnailContext, "width" | "height">): ThumbConfig => ({
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
  if (words < WORDS[0] || words > WORDS[1]) problems.push(`the text is ${words} words; use ${WORDS[0]}–${WORDS[1]}`)
  return problems
}
