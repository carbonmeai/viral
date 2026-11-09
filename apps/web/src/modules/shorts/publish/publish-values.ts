import type { PostText, PublishedShort, PublishStatus } from "@viral/contracts"

// A title longer than this gets cut off on a phone.
export const TITLE_CHARS = 40
// YouTube's limit for a Shorts title; the server checks it too.
export const TITLE_LIMIT = 100

export interface TitleChoice {
  readonly text: string
  readonly chars: number
  readonly tooLong: boolean
  // a title you wrote, not one of the agent's
  readonly yours: boolean
}

const choice = (text: string, yours: boolean): TitleChoice => ({ text, chars: text.length, tooLong: text.length > TITLE_CHARS, yours })

// The titles to choose from: the agent's pick first, then its alternates, each with its length; a title you wrote
// comes first when it's none of those.
export const titleChoices = (metadata: Pick<PublishedShort, "title" | "alternates">, chosen?: string): ReadonlyArray<TitleChoice> => {
  const agent = [metadata.title, ...metadata.alternates]
  return [...(chosen === undefined || agent.includes(chosen) ? [] : [choice(chosen, true)]), ...agent.map((t) => choice(t, false))]
}

// What you paste into the upload form: the title you chose, then the description, the credit when the footage
// isn't yours, and the hashtags.
export const postText = (post: PostText, credit: string | null) =>
  [post.title, "", post.description, ...(credit === null ? [] : ["", `Credit: ${credit}`]), "", post.hashtags.join(" ")].join("\n")

// Hashtags as you type them, space or comma separated; a missing # is added.
export const parseHashtags = (text: string) =>
  text.split(/[\s,]+/).filter((h) => h !== "").map((h) => h.startsWith("#") ? h : `#${h}`)

const NAMES: Record<PublishStatus["changes"][number], string> = {
  title: "title",
  description: "description",
  hashtags: "hashtags",
  credit: "credit",
  video: "video",
  missing: "missing files"
}

const and = (names: ReadonlyArray<string>) => names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`

// "title, credit and video"
export const listChanges = (changes: PublishStatus["changes"]) => and(changes.map((c) => NAMES[c]))

// What "Publish again" will do, in one plain line.
export const republishLine = (status: Pick<PublishStatus, "changes" | "rerender">) => {
  if (status.rerender) return "Re-renders the video with the new credit (no agent work; you approve it), then replaces the files."
  const text = status.changes.filter((c) => c !== "video" && c !== "missing")
  const parts = [
    ...(status.changes.includes("video") ? ["copies the latest render"] : []),
    ...(text.length > 0 ? [`rewrites the post text with the new ${listChanges(text)}`] : []),
    ...(status.changes.includes("missing") && !status.changes.includes("video") ? ["puts back the missing files"] : [])
  ]
  const line = and(parts)
  return line === "" ? "" : `${line[0]!.toUpperCase()}${line.slice(1)}.`
}

// What the Publish step says about the credit and the rights, over every video the short uses: why there's no
// credit line, the videos you haven't confirmed you may use, and credited videos with no channel to name.
export interface RightsNotes {
  // shown when there's no credit line
  readonly none: string
  // the warning to confirm the rights first, or null when every video is confirmed
  readonly unconfirmed: string | null
  // "Heidi Klum has no channel to credit…", or null
  readonly noChannel: string | null
}

export const rightsNotes = (videos: ReadonlyArray<{ readonly name: string; readonly rights: string; readonly channel: string | null }>): RightsNotes => {
  const several = videos.length > 1
  const unconfirmed = videos.filter((v) => v.rights === "unconfirmed").map((v) => v.name)
  const nameless = videos.filter((v) => v.rights !== "owned" && (v.channel === null || v.channel.trim() === "")).map((v) => v.name)
  return {
    none: videos.every((v) => v.rights === "owned")
      ? "None: the footage is yours."
      : several
      ? "None: the videos had no channel to credit. Add it on each video's page, then publish again."
      : "None: the video had no channel to credit. Add it on the video's page, then publish again.",
    unconfirmed: unconfirmed.length === 0
      ? null
      : several
      ? `You haven't confirmed you own or have permission to use the footage of ${and(unconfirmed)}. Set it on each video's page before you post.`
      : "You haven't confirmed you own or have permission to use this footage. Set it on the video's page before you post.",
    noChannel: !several || nameless.length === 0 || nameless.length === videos.length
      ? null
      : `${and(nameless)} ${nameless.length === 1 ? "has" : "have"} no channel to credit. Add it on the video's page, then publish again.`
  }
}
