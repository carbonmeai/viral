import type { Change, ChatCheck, Thumbnail } from "@viral/contracts"
import { changed, changeOf, clock, passed } from "../chat/change-lines.ts"

// An AI round: the option in use, the words and the frames it's made from.
const describeRoundChange = (before: Thumbnail, after: Thumbnail, videoName: (source: number) => string): Change | null => {
  const a = before.generated
  const b = after.generated
  if (b === undefined) return null
  const pickOf = (t: Thumbnail) => {
    const g = t.generated
    const n = g === undefined ? null : g.chosen ?? g.recommended
    return n === null ? null : `option ${n}`
  }
  const frames = (t: Thumbnail) => (t.generated?.inputs ?? []).map((i) => `${i.role} ${videoName(i.source ?? 0)} ${clock(i.src)}`).join(", ")
  if (a !== undefined && a.prompt === b.prompt && a.options.every((o, i) => o.image === b.options[i]?.image)) {
    return changeOf("Chose another option", [changed("Option", pickOf(before), pickOf(after))].filter((l) => l.old !== l.new))
  }
  const lines = [
    a?.design.words === b.design.words ? null : changed("Words", a?.design.words ?? null, b.design.words),
    frames(before) === frames(after) ? null : changed("Frames", frames(before) || null, frames(after)),
    changed("Option", pickOf(before), pickOf(after))
  ].filter((l) => l !== null)
  return changeOf("Made another round of thumbnails", lines)
}

// Layout, words, the hero and face moments (video and time) and the colours; for an AI round, the option and frames.
export const describeThumbnailChange = (before: Thumbnail, after: Thumbnail, videoName: (source: number) => string): Change | null => {
  if (after.generated !== undefined) return describeRoundChange(before, after, videoName)
  const a = before.config
  const b = after.config
  if (a === null || b === null) return null
  const words = (config: NonNullable<Thumbnail["config"]>) => config.lines.map((l) => l.text).join(" / ")
  const at = (layer: { readonly src: number; readonly source?: number } | undefined) =>
    layer === undefined ? null : `${videoName(layer.source ?? 0)} ${clock(layer.src)}`
  const lines = [
    (a.layout ?? "classic") === (b.layout ?? "classic") ? null : changed("Layout", a.layout ?? "classic", b.layout ?? "classic"),
    words(a) === words(b) ? null : changed("Words", words(a), words(b)),
    at(a.hero) === at(b.hero) ? null : changed("Hero", at(a.hero), at(b.hero)),
    at(a.inset) === at(b.inset) ? null : changed("Face", at(a.inset), at(b.inset)),
    (a.backdrop?.colors ?? []).join(" → ") === (b.backdrop?.colors ?? []).join(" → ")
      ? null
      : changed("Colours", a.backdrop?.colors.join(" → ") ?? null, b.backdrop?.colors.join(" → ") ?? null),
    a.emoji?.char === b.emoji?.char ? null : changed("Emoji", a.emoji?.char ?? null, b.emoji?.char ?? null)
  ].filter((l) => l !== null)
  return changeOf(lines.length === 1 ? `Changed the ${lines[0]!.label.toLowerCase()}` : "Changed the thumbnail", lines)
}

// An AI round's checks: real frames only, and how the faces matched (the agent's scores).
export const aiThumbnailChecks = (g: NonNullable<Thumbnail["generated"]>): ReadonlyArray<ChatCheck> => {
  const made = g.options.filter((o) => o.image !== null)
  const best = made.reduce<number | null>((n, o) => o.faces === null ? n : Math.max(n ?? 0, o.faces), null)
  return [
    passed(`Made from ${g.inputs.length} real frames, inside their videos and outside ads and end screens`),
    passed(`${made.length} of ${g.options.length} options made${best === null ? "" : `; best face match ${Math.round(best)}/10`}`)
  ]
}

export const thumbnailChecks: ReadonlyArray<ChatCheck> = [
  passed("Every moment is inside its video, outside ads and end screens"),
  passed("Crops stay sharp and fit their slots"),
  passed("One or two lines of words, big enough to read on a phone")
]

export const thumbnailSummary = (t: Thumbnail) => {
  if (t.generated !== undefined) {
    const g = t.generated
    const made = g.options.filter((o) => o.image !== null).length
    const pick = g.chosen ?? g.recommended
    return `The thumbnail: “${g.design.words}”, ${made} of ${g.options.length} AI options made from ${g.inputs.length} real frames` +
      `${pick === null ? "" : `, option ${pick} ${g.chosen === null ? "recommended" : "chosen"}`}.`
  }
  return t.config === null ? "The thumbnail." : `The thumbnail: “${t.config.lines.map((l) => l.text).join(" ")}”, ${t.config.layout ?? "classic"} layout.`
}
