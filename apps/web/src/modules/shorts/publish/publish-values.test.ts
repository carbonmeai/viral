import assert from "node:assert/strict"
import { test } from "node:test"
import { listChanges, parseHashtags, postText, republishLine, TITLE_CHARS, titleChoices } from "./publish-values.ts"

const metadata = {
  title: "He Put 7 Tastes Into 1 Candy",
  alternates: ["One Candy, 7 Tastes at Once", "He Made a Candy That Hits Every Single Taste at Once"],
  description: "This creator packed seven tastes into one candy.",
  hashtags: ["#shorts", "#candy"]
}

test("title choices put the agent's pick first and flag ones a phone would cut off", () => {
  const choices = titleChoices(metadata)
  assert.deepEqual(choices.map((c) => c.text), [metadata.title, ...metadata.alternates])
  assert.deepEqual(choices.map((c) => c.tooLong), [false, false, true])
  assert.equal(choices[0]?.chars, 28)
  assert.equal(TITLE_CHARS, 40)
  assert.deepEqual(titleChoices(metadata, metadata.alternates[0]).map((c) => c.yours), [false, false, false], "an alternate isn't yours")
})

test("a title you wrote comes first", () => {
  const choices = titleChoices(metadata, "Seven Tastes, One Candy")
  assert.deepEqual(choices.map((c) => [c.text, c.yours]).slice(0, 2), [["Seven Tastes, One Candy", true], [metadata.title, false]])
})

test("the post text has the chosen title, the description, the credit and the hashtags", () => {
  const post = { ...metadata, title: "One Candy, 7 Tastes at Once" }
  assert.equal(
    postText(post, "NileBlue"),
    "One Candy, 7 Tastes at Once\n\nThis creator packed seven tastes into one candy.\n\nCredit: NileBlue\n\n#shorts #candy"
  )
  assert.equal(postText({ ...post, title: "T" }, null), "T\n\nThis creator packed seven tastes into one candy.\n\n#shorts #candy", "no credit line for your own footage")
})

test("hashtags as typed get their # and lose the separators", () => {
  assert.deepEqual(parseHashtags(" #shorts candy,  #science "), ["#shorts", "#candy", "#science"])
})

test("what publishing again does, in plain words", () => {
  assert.equal(listChanges(["title", "credit", "video"]), "title, credit and video")
  assert.equal(republishLine({ changes: ["title", "credit"], rerender: false }), "Rewrites the post text with the new title and credit.")
  assert.equal(republishLine({ changes: ["credit", "video"], rerender: true }), "Re-renders the video with the new credit (no agent work; you approve it), then replaces the files.")
  assert.equal(republishLine({ changes: ["video", "missing"], rerender: false }), "Copies the latest render.")
  assert.equal(republishLine({ changes: ["hashtags", "missing"], rerender: false }), "Rewrites the post text with the new hashtags and puts back the missing files.")
})
