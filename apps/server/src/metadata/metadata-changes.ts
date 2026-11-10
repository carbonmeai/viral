import type { Change, ChatCheck, ShortMetadata } from "@viral/contracts"
import { changed, changeOf, passed } from "../chat/change-lines.ts"
import { TITLE_CHARS } from "./metadata-rules.ts"

// Title old → new, alternates, description and hashtags added or removed.
export const describeMetadataChange = (before: ShortMetadata, after: ShortMetadata): Change | null => {
  const addedTags = after.hashtags.filter((h) => !before.hashtags.includes(h))
  const removedTags = before.hashtags.filter((h) => !after.hashtags.includes(h))
  const lines = [
    before.title === after.title ? null : changed("Title", before.title, after.title),
    before.alternates.join(" · ") === after.alternates.join(" · ") ? null : changed("Other titles", before.alternates.join(" · "), after.alternates.join(" · ")),
    before.description === after.description ? null : changed("Description", before.description, after.description),
    addedTags.length + removedTags.length === 0 ? null : changed("Hashtags", removedTags.length === 0 ? null : removedTags.join(" "), addedTags.length === 0 ? null : addedTags.join(" "))
  ].filter((l) => l !== null)
  return changeOf(lines.length === 1 ? `Changed the ${lines[0]!.label.toLowerCase()}` : "Changed the post text", lines)
}

export const metadataChecks = (metadata: ShortMetadata): ReadonlyArray<ChatCheck> => [
  passed(`Title ${metadata.title.length} characters, under ${TITLE_CHARS}`),
  passed("Two or three other titles, none repeating it"),
  passed("Every channel whose footage plays is credited")
]

export const metadataSummary = (metadata: ShortMetadata) => `The post text: “${metadata.title}”.`
