import assert from "node:assert/strict"
import { test } from "node:test"
import { briefOf, fileParts, linksIn, madeAs, promptChip, promptProblem, readPrompt, startOf, videosOf } from "./prompt-values.ts"

test("plain words are an idea; too little is nothing yet", () => {
  assert.deepEqual(readPrompt("  Top 5 animal rescue comebacks, before and after ", []), { _tag: "Idea", text: "Top 5 animal rescue comebacks, before and after" })
  assert.deepEqual(readPrompt("", []), { _tag: "Empty" })
  assert.deepEqual(readPrompt(" hi ", []), { _tag: "Empty" })
  assert.equal(startOf(readPrompt("Heidi Klum's costumes", [])), "find")
  assert.equal(promptChip(readPrompt("Heidi Klum's costumes", [])).label, "Idea · finds videos")
  assert.equal(promptChip(readPrompt("", [])).label, "An idea, a link or a file")
})

test("one link reads one video, whatever its shape", () => {
  for (const link of [
    "https://www.youtube.com/watch?v=ukFq3pLmK2s",
    "https://youtu.be/ukFq3pLmK2s",
    "https://youtube.com/shorts/Hk25Hand0w",
    "https://www.tiktok.com/@nile/video/7312"
  ]) {
    const prompt = readPrompt(link, [])
    assert.deepEqual(prompt, { _tag: "Links", urls: [link], rest: "" }, link)
    assert.equal(startOf(prompt), "one")
    assert.equal(promptChip(prompt).label, "Link · downloads")
  }
  // pasted without its scheme, or ending a sentence
  assert.deepEqual(linksIn("youtu.be/ukFq3pLmK2s"), ["https://youtu.be/ukFq3pLmK2s"])
  assert.deepEqual(linksIn("see www.youtube.com/watch?v=ukFq3pLmK2s."), ["https://www.youtube.com/watch?v=ukFq3pLmK2s"])
  assert.deepEqual(linksIn("(https://youtu.be/ukFq3pLmK2s)"), ["https://youtu.be/ukFq3pLmK2s"])
})

test("several links make one set; the words besides them are its brief", () => {
  const text = "https://youtube.com/watch?v=ukFq3pLmK2s\nhttps://youtube.com/shorts/Hk25Hand0w\nCompare the two builds"
  const prompt = readPrompt(text, [])
  assert.deepEqual(prompt, {
    _tag: "Links",
    urls: ["https://youtube.com/watch?v=ukFq3pLmK2s", "https://youtube.com/shorts/Hk25Hand0w"],
    rest: "Compare the two builds"
  })
  assert.equal(startOf(prompt), "set")
  assert.equal(promptChip(prompt).label, "2 links · one short")
  assert.equal(briefOf(prompt), "Compare the two builds")
  assert.equal(promptProblem(prompt, briefOf(prompt)), null)
  // the same link twice is one video; links with no words need a brief
  const twice = readPrompt("https://youtu.be/a1 https://youtu.be/a1 https://youtu.be/b2", [])
  assert.equal(videosOf(twice).length, 2)
  assert.equal(promptProblem(twice, briefOf(twice)), "Say what these shorts should achieve.")
  // at most 10 videos
  const eleven = readPrompt(Array.from({ length: 11 }, (_, i) => `https://youtu.be/v${i}`).join(" "), [])
  assert.match(promptProblem(eleven, "x") ?? "", /^Up to 10 videos in one short; remove 1\./)
})

test("a link with words before it is still a link, not an idea", () => {
  const prompt = readPrompt("make a short from https://youtu.be/ukFq3pLmK2s please", [])
  assert.equal(prompt._tag, "Links")
  assert.equal(startOf(prompt), "one")
  assert.equal(briefOf(prompt), "make a short from please")
})

test("a dropped file, several files, or a typed path read from this Mac", () => {
  const one = readPrompt("anything typed", ["/Users/me/Movies/candy.mp4"])
  assert.deepEqual(one, { _tag: "File", path: "/Users/me/Movies/candy.mp4" })
  assert.equal(startOf(one), "one")
  assert.equal(promptChip(one).label, "File · from this Mac")
  assert.deepEqual(readPrompt(" /Users/me/My Movies/candy.mp4 ", []), { _tag: "File", path: "/Users/me/My Movies/candy.mp4" })
  const two = readPrompt("Same candy, two takes", ["/a/one.mp4", "/a/two.mov"])
  assert.equal(startOf(two), "set")
  assert.equal(promptChip(two).label, "2 files · one short")
  assert.deepEqual(videosOf(two), [{ _tag: "File", path: "/a/one.mp4" }, { _tag: "File", path: "/a/two.mov" }])
  assert.equal(briefOf(two), "Same candy, two takes")
  // a slash inside an idea doesn't make it a path
  assert.equal(readPrompt("before/after rescues", [])._tag, "Idea")
})

test("a file's name and folder read the way Finder says them", () => {
  assert.deepEqual(fileParts("/Users/me/Movies/candy.mp4"), { name: "candy.mp4", folder: "~/Movies" })
  assert.deepEqual(fileParts("/Volumes/Drive/clips/a.mov"), { name: "a.mov", folder: "/Volumes/Drive/clips" })
  assert.deepEqual(fileParts("/a.mp4"), { name: "a.mp4", folder: "/" })
})

test("Made as follows the card, else the idea's own words", () => {
  assert.equal(madeAs("ranking", false, 5), "A ranking of 5")
  assert.equal(madeAs(null, true, 7), "A ranking of 7")
  assert.equal(madeAs("narrated", true, 5), "A narrated short across the videos")
  assert.equal(madeAs(null, false, 5), "Three suggested shorts across the videos")
})
