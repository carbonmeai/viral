import assert from "node:assert/strict"
import { test } from "node:test"
import { checkMetadata, postNotes } from "./metadata-rules.ts"

const good = {
  title: "He Put 7 Tastes Into 1 Candy",
  alternates: ["He Made a Candy That Breaks Your Tongue", "The Most Extreme Candy Ever"],
  description: "This guy packed sweet, sour, salty, bitter, savory, spicy and ice-cold into one candy. How does it taste?",
  hashtags: ["#shorts", "#science", "#candy", "#experiment", "#viral"]
}

test("a good post passes", () => {
  assert.deepEqual(checkMetadata(good).problems, [])
})

test("reports long titles, missing alternates, and malformed hashtags", () => {
  const text = checkMetadata({
    title: "He Put Every Single Taste There Is Into One Candy",
    alternates: ["He Put Every Single Taste There Is Into One Candy"],
    description: "x",
    hashtags: ["#science", "candy", "#Big Tags"]
  }).problems.join("\n")
  assert.match(text, /title is 49 characters/)
  assert.match(text, /two or three alternate titles, not 1/)
  assert.match(text, /repeats the title/)
  assert.match(text, /hashtags are # plus one lowercase word: candy, #big tags/)
  assert.match(text, /start the hashtags with #shorts/)
})

test("the post notes carry the credit when the footage isn't yours", () => {
  const notes = postNotes({ metadata: good, credit: "NileBlue", approach: "claim-interleaved", style: "Headline full-bleed", durationS: 49.5 })
  assert.match(notes, /^# He Put 7 Tastes Into 1 Candy/)
  assert.match(notes, /\*\*Length:\*\* 49\.5s/)
  assert.match(notes, /Credit: NileBlue\n\n#shorts #science/)
})
