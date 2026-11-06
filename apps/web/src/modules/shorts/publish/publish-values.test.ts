import assert from "node:assert/strict"
import { test } from "node:test"
import { postText, TITLE_CHARS, titleChoices } from "./publish-values.ts"

const metadata = {
  title: "He Put 7 Tastes Into 1 Candy",
  alternates: ["One Candy, 7 Tastes at Once", "He Made a Candy That Hits Every Single Taste at Once"],
  description: "This creator packed seven tastes into one candy.",
  credit: "NileBlue",
  hashtags: ["#shorts", "#candy"]
}

test("title choices put the agent's pick first and flag ones a phone would cut off", () => {
  const choices = titleChoices(metadata)
  assert.deepEqual(choices.map((c) => c.text), [metadata.title, ...metadata.alternates])
  assert.deepEqual(choices.map((c) => c.tooLong), [false, false, true])
  assert.equal(choices[0]?.chars, 28)
  assert.equal(TITLE_CHARS, 40)
})

test("the post text has the chosen title, the description, the credit and the hashtags", () => {
  assert.equal(
    postText(metadata, "One Candy, 7 Tastes at Once"),
    "One Candy, 7 Tastes at Once\n\nThis creator packed seven tastes into one candy.\n\nCredit: NileBlue\n\n#shorts #candy"
  )
  assert.equal(postText({ ...metadata, credit: null }, "T"), "T\n\nThis creator packed seven tastes into one candy.\n\n#shorts #candy", "no credit line for your own footage")
})
