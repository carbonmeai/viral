import type { Change, ChatCheck, MusicBed } from "@viral/contracts"
import { changed, changeOf, passed } from "../chat/change-lines.ts"

const word = (bed: MusicBed) => bed.dropWordText === null ? "the last narrated line" : `“${bed.dropWordText.replace(/[^\p{L}\p{N}']+$/u, "")}”`
const arranged = (bed: MusicBed) => bed.arrangement === undefined ? "automatic" : "yours"

// Song A → B, the drop word, and the arrangement automatic ↔ yours, from two fitted beds (null: voice only).
export const describeMusicChange = (before: MusicBed | null, after: MusicBed | null): Change | null => {
  if (before === null && after === null) return null
  if (after === null) return changeOf("No music now", [changed("Song", before!.trackTitle, "Voice only")])
  if (before === null) return changeOf(`Added “${after.trackTitle}”`, [changed("Song", "Voice only", after.trackTitle), changed("Drop", null, word(after))])
  const lines = [
    before.trackId === after.trackId ? null : changed("Song", before.trackTitle, after.trackTitle),
    word(before) === word(after) ? null : changed("Drop on", word(before), word(after)),
    arranged(before) === arranged(after) ? null : changed("Arrangement", arranged(before), arranged(after))
  ].filter((l) => l !== null)
  return changeOf(lines.length === 1 && lines[0]!.label === "Drop on" ? `The drop lands on ${word(after)} now` : "Changed the music", lines)
}

export const musicChecks = (bed: MusicBed): ReadonlyArray<ChatCheck> => [
  passed(`The drop lands on ${word(bed)}`),
  passed("The song loops in whole bars")
]

export const musicSummary = (bed: MusicBed | null) =>
  bed === null ? "The short plays voice only." : `“${bed.trackTitle}” fitted so the drop lands on ${word(bed)}.`
