import type { PublishedShort } from "@viral/contracts"

// A title longer than this gets cut off on a phone.
export const TITLE_CHARS = 40

// The titles to choose from: the agent's pick first, then its alternates, each with its length.
export const titleChoices = (metadata: Pick<PublishedShort, "title" | "alternates">) =>
  [metadata.title, ...metadata.alternates].map((text) => ({ text, chars: text.length, tooLong: text.length > TITLE_CHARS }))

// What you paste into the upload form: the title you chose, then the description, the credit when the footage
// isn't yours, and the hashtags.
export const postText = (metadata: Pick<PublishedShort, "description" | "credit" | "hashtags">, title: string) =>
  [title, "", metadata.description, ...(metadata.credit === null ? [] : ["", `Credit: ${metadata.credit}`]), "", metadata.hashtags.join(" ")].join("\n")
