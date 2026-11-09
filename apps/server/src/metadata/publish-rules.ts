import type { PostText, PublishChange, PublishedShort } from "@viral/contracts"
import type { Checked } from "../agent-session/run-checked.ts"
import { creditedChannels } from "../projects/credits.ts"

// YouTube's own limits for what you type in: a Shorts title, a description, and how many hashtags it keeps.
export const POST_LIMITS = { title: 100, description: 5000, hashtags: 15 } as const

// The settings key holding the text you post a short with (a PostText), once you chose a title or edited it;
// without it the post is the agent's. New metadata from the agent removes it.
export const postKey = (projectId: string) => `project.${projectId}.publish.post`

// Checks post text you typed: a title of 1–100 characters, a description, and hashtags of # plus a word (a
// missing # is added). Whitespace is trimmed.
export const checkPost = (post: PostText): Checked<PostText> => {
  const problems: Array<string> = []
  const title = post.title.trim().replace(/\s+/g, " ")
  if (title === "") problems.push("the title is empty")
  if (title.length > POST_LIMITS.title) problems.push(`the title is ${title.length} characters; YouTube allows ${POST_LIMITS.title}`)
  const description = post.description.trim()
  if (description === "") problems.push("the description is empty")
  if (description.length > POST_LIMITS.description) {
    problems.push(`the description is ${description.length} characters; YouTube allows ${POST_LIMITS.description}`)
  }
  const hashtags = post.hashtags.map((h) => h.trim()).filter((h) => h !== "").map((h) => h.startsWith("#") ? h : `#${h}`)
  if (hashtags.length > POST_LIMITS.hashtags) problems.push(`use at most ${POST_LIMITS.hashtags} hashtags, not ${hashtags.length}`)
  const bad = hashtags.filter((h) => !/^#[\p{L}\p{N}_]+$/u.test(h))
  if (bad.length > 0) problems.push(`a hashtag is # plus one word, no spaces or punctuation: ${bad.join(", ")}`)
  return { value: { title, description, hashtags: [...new Set(hashtags)] }, problems }
}

// The credit line in the description: every channel whose footage the short uses and isn't yours ("NileBlue ·
// Mark Rober"), or null.
export const postCredit = (sources: ReadonlyArray<{ readonly rights: string; readonly channel: string | null }>) =>
  creditedChannels(sources).join(" · ") || null

// The agent's post text, as the metadata stage wrote it.
export const agentPost = (metadata: PostText): PostText => ({
  title: metadata.title,
  description: metadata.description,
  hashtags: metadata.hashtags
})

const samePost = (a: PostText, b: PostText) =>
  a.title === b.title && a.description === b.description && a.hashtags.join(" ") === b.hashtags.join(" ")

export interface PublishState {
  // the latest published version
  readonly published: PublishedShort
  // your post text (absent: the agent's)
  readonly saved: PostText | null
  // the description's credit as it reads now
  readonly credit: string | null
  // the credit the video's style would draw now, and the one its last assembled plan draws (null: none)
  readonly drawnCredit: { readonly now: string | null; readonly planned: string | null } | null
  // there's a render newer than the published mp4
  readonly newerRender: boolean
  // which of the published files are in the renders folder
  readonly missing: boolean
}

// What publishing again would change, in the order the Publish step lists them.
export const publishChanges = (state: PublishState) => {
  const posted = state.published.posted ?? agentPost(state.published)
  const post = state.saved ?? agentPost(state.published)
  const rerender = state.drawnCredit !== null && state.drawnCredit.now !== state.drawnCredit.planned
  const changes: Array<PublishChange> = [
    ...(post.title !== posted.title ? ["title" as const] : []),
    ...(post.description !== posted.description ? ["description" as const] : []),
    ...(post.hashtags.join(" ") !== posted.hashtags.join(" ") ? ["hashtags" as const] : []),
    ...(state.credit !== state.published.credit ? ["credit" as const] : []),
    ...(rerender || state.newerRender ? ["video" as const] : []),
    ...(state.missing ? ["missing" as const] : [])
  ]
  return { post, edited: !samePost(post, agentPost(state.published)), changes, rerender }
}
