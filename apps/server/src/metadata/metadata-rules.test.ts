import assert from "node:assert/strict"
import { test } from "node:test"
import { checkMetadata, checkRankingMetadata, postNotes } from "./metadata-rules.ts"

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
  const notes = postNotes({ post: good, alternates: good.alternates, credit: "NileBlue", approach: "claim-interleaved", style: "Headline full-bleed", durationS: 49.5 })
  assert.match(notes, /^# He Put 7 Tastes Into 1 Candy/)
  assert.match(notes, /\*\*Length:\*\* 49\.5s/)
  assert.match(notes, /Credit: NileBlue\n\n#shorts #science/)
})

test("a ranking's post ends \"Wait for #1.\", credits its footage and lists each rank's source", () => {
  const ranking = { ...good, title: "Top 5 Animal Comebacks (Before & After)", description: "Five rescues, from skin and bone to running free. Wait for #1." }
  assert.deepEqual(checkRankingMetadata(ranking), [])
  assert.match(checkRankingMetadata(good).join(), /ends "Wait for #1\."/)
  const notes = postNotes({
    post: ranking,
    alternates: [],
    credit: "The Dodo · Hope For Paws",
    approach: "ranking",
    style: "Default",
    durationS: 84,
    sources: ["#1 Horse who gave up: Hope For Paws, https://www.youtube.com/watch?v=c", "#2 Puppy: The Dodo, https://www.youtube.com/watch?v=a"]
  })
  assert.match(notes, /Wait for #1\.\n\nFootage: The Dodo · Hope For Paws\n\nSources:\n- #1 Horse who gave up: Hope For Paws, https/)
})
