import type { Shortlist, ShortlistVideo } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import {
  addPick,
  askForAnother,
  changed,
  defaultLength,
  downloadLabel,
  estimateLine,
  momentsLine,
  movePick,
  newListNote,
  removePick,
  useBackup,
  videoFacts
} from "./research-values.ts"

const video = (videoId: string, title = videoId): ShortlistVideo => ({
  videoId,
  url: `https://www.youtube.com/watch?v=${videoId}`,
  title,
  channel: "The Dodo",
  durationS: 185,
  views: 759937,
  uploadDate: "2026-02-07",
  thumbnail: null,
  part: `#: ${title}`,
  why: "w",
  moments: [{ label: "before", at: 12 }, { label: "after", at: null }],
  addedBy: "agent",
  sourceId: null
})
const list: Shortlist = { idea: "i", summary: "s", searches: [], picks: [video("a"), video("b"), video("c")], backups: [video("x"), video("y")], replacing: null }

test("New › From an idea: rankings start at Up to 3 min, with an estimate under the choice", () => {
  assert.equal(defaultLength("Top 10 animal rescue comebacks"), "180")
  assert.equal(defaultLength("The most dramatic bridge demolitions, ranked"), "180")
  assert.equal(defaultLength("Heidi Klum's Halloween costumes over the years"), "60")
  assert.equal(estimateLine(10, "180"), "10 videos as a ranking ≈ 2:40")
  assert.equal(estimateLine(5, "60"), "5 videos as a ranking ≈ 1:25, so in 60s each video gets only a moment or two")
  assert.equal(estimateLine(3, "any"), "3 videos as a ranking ≈ 0:55")
})

test("a row reads channel · length · views, the upload date in Detailed, and the moments as guesses", () => {
  assert.equal(videoFacts(video("a"), false), "The Dodo · 3:05 · 760k views")
  assert.equal(videoFacts(video("a"), true), "The Dodo · 3:05 · 760k views · 2026-02-07")
  assert.equal(momentsLine(video("a")), "Expects (a guess): before ~0:12 · after")
})

test("changing the list: remove, reorder, a backup in a pick's place, a link added once", () => {
  assert.deepEqual(removePick(list, 1).picks.map((p) => p.videoId), ["a", "c"])
  assert.deepEqual(movePick(list, 0, 1).picks.map((p) => p.videoId), ["b", "a", "c"])
  assert.equal(movePick(list, 0, -1), list)
  const swapped = useBackup(list, 1, 2)
  assert.deepEqual(swapped.picks.map((p) => p.videoId), ["a", "b", "y"])
  assert.deepEqual(swapped.backups.map((p) => p.videoId), ["x"])
  assert.deepEqual(addPick(list, video("z")).picks.map((p) => p.videoId), ["a", "b", "c", "z"])
  assert.equal(addPick(list, video("x")), list, "a backup is already on the list")
  assert.ok(!changed(list, { ...list }))
  assert.ok(changed(list, swapped))
  assert.equal(downloadLabel(5), "Download 5 videos")
})

test("Ask for another uses a backup first, then asks the agent, telling it about your changes", () => {
  const first = askForAnother(list, list, 1)
  assert.equal(first._tag, "Backup")
  assert.deepEqual(first._tag === "Backup" ? first.list.picks.map((p) => p.videoId) : [], ["a", "x", "c"])
  const noBackups = { ...list, backups: [] }
  const asked = askForAnother(list, movePick(noBackups, 0, 1), 2)
  assert.equal(asked._tag, "Agent")
  assert.match(asked._tag === "Agent" ? asked.note : "", /^Find another video for spot 3 instead of c "c" \(#: c\); keep the other videos where they are\.\n\nI changed the list to:\n1\. b "b"/)
  assert.equal(newListNote(list, list, "  More variety "), "More variety")
  assert.match(newListNote(list, removePick(list, 0), "More variety"), /My changes so far:\n1\. b "b" \(#: b\)\n2\. c/)
})
