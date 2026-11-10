import type { Change, ChatCheck, Thumbnail } from "@viral/contracts"
import { changed, changeOf, clock, passed } from "../chat/change-lines.ts"

// Layout, words, the hero and face moments (video and time) and the colours.
export const describeThumbnailChange = (before: Thumbnail, after: Thumbnail, videoName: (source: number) => string): Change | null => {
  const a = before.config
  const b = after.config
  const words = (t: Thumbnail) => t.config.lines.map((l) => l.text).join(" / ")
  const at = (layer: { readonly src: number; readonly source?: number } | undefined) =>
    layer === undefined ? null : `${videoName(layer.source ?? 0)} ${clock(layer.src)}`
  const lines = [
    (a.layout ?? "classic") === (b.layout ?? "classic") ? null : changed("Layout", a.layout ?? "classic", b.layout ?? "classic"),
    words(before) === words(after) ? null : changed("Words", words(before), words(after)),
    at(a.hero) === at(b.hero) ? null : changed("Hero", at(a.hero), at(b.hero)),
    at(a.inset) === at(b.inset) ? null : changed("Face", at(a.inset), at(b.inset)),
    (a.backdrop?.colors ?? []).join(" → ") === (b.backdrop?.colors ?? []).join(" → ")
      ? null
      : changed("Colours", a.backdrop?.colors.join(" → ") ?? null, b.backdrop?.colors.join(" → ") ?? null),
    a.emoji?.char === b.emoji?.char ? null : changed("Emoji", a.emoji?.char ?? null, b.emoji?.char ?? null)
  ].filter((l) => l !== null)
  return changeOf(lines.length === 1 ? `Changed the ${lines[0]!.label.toLowerCase()}` : "Changed the thumbnail", lines)
}

export const thumbnailChecks: ReadonlyArray<ChatCheck> = [
  passed("Every moment is inside its video, outside ads and end screens"),
  passed("Crops stay sharp and fit their slots"),
  passed("One or two lines of words, big enough to read on a phone")
]

export const thumbnailSummary = (t: Thumbnail) => `The thumbnail: “${t.config.lines.map((l) => l.text).join(" ")}”, ${t.config.layout ?? "classic"} layout.`
