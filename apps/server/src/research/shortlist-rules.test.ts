import type { ProposedShortlist, Shortlist, ShortlistVideo } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { checkShortlist, checkShortlistEdit, type ShortlistContext } from "./shortlist-rules.ts"
import type { VideoFound } from "./youtube-values.ts"

const found = (videoId: string, title: string, durationS: number | null, live: boolean | null = false): VideoFound =>
  ({ videoId, title, channel: "The Dodo", durationS, views: 1000, live })
const videos = new Map([
  found("Si0P5CmgiwU", "Extremely Matted Dog", 481),
  found("XMkilsT2Ahs", "Walking Cotton Ball", 103),
  found("jBR63No8O7s", "Buried Alive in Fur", 3901),
  found("LIVELIVELIV", "Kitten cam", null, true),
  found("jP4vNf1VvJE", "Giant Rescue Horse", 198),
  found("kxPGFEuhT4o", "Donkey With Overgrown Hooves", 385)
].map((v) => [v.videoId, v]))
const context = (over: Partial<ShortlistContext> = {}): ShortlistContext => ({
  count: 3,
  videos,
  unavailable: new Map([["A3qhJbqA--k", "Video unavailable"]]),
  searches: ["matted dog rescue transformation"],
  idea: "Top 3 rescue comebacks",
  replacing: null,
  ...over
})
const pick = (video: string, part = "#1") => ({ video, part, why: "It has the whole story.", moments: [{ label: "before", at: 5 }, { label: "after", at: null }] })
const list = (picks: ReadonlyArray<string>, backups: ReadonlyArray<string> = []): ProposedShortlist =>
  ({ summary: "Searched by animal, then by channel.", picks: picks.map((v, i) => pick(v, `#${i + 1}`)), backups: backups.map((v) => pick(v, "spare")) })

test("a good list passes and takes each video's details from YouTube, not the agent", () => {
  const checked = checkShortlist(list(["Si0P5CmgiwU", "https://www.youtube.com/watch?v=XMkilsT2Ahs", "jP4vNf1VvJE"], ["kxPGFEuhT4o"]), context())
  assert.deepEqual(checked.problems, [])
  assert.deepEqual(checked.value.picks.map((p) => [p.videoId, p.title, p.durationS]), [
    ["Si0P5CmgiwU", "Extremely Matted Dog", 481],
    ["XMkilsT2Ahs", "Walking Cotton Ball", 103],
    ["jP4vNf1VvJE", "Giant Rescue Horse", 198]
  ])
  assert.equal(checked.value.picks[1]!.url, "https://www.youtube.com/watch?v=XMkilsT2Ahs")
  assert.equal(checked.value.backups[0]!.videoId, "kxPGFEuhT4o")
  assert.deepEqual(checked.value.searches, ["matted dog rescue transformation"])
})

test("live streams, long videos, duplicates, unknown or unavailable videos, the wrong count and too many backups are problems", () => {
  const checked = checkShortlist({
    ...list(["Si0P5CmgiwU", "jBR63No8O7s", "LIVELIVELIV", "youtu.be/Si0P5CmgiwU"], ["A3qhJbqA--k", "zzzzzzzzzzz", "XMkilsT2Ahs", "jP4vNf1VvJE", "kxPGFEuhT4o"]),
    picks: [...list(["Si0P5CmgiwU", "jBR63No8O7s", "LIVELIVELIV"]).picks, pick("https://youtu.be/Si0P5CmgiwU")]
  }, context())
  const all = checked.problems.join("\n")
  assert.match(all, /pick 2: "Buried Alive in Fur" is 1:05:01 long; pick videos up to 20 minutes/)
  assert.match(all, /pick 3: "Kitten cam" is a live stream/)
  assert.match(all, /pick 4: "Extremely Matted Dog" is already on the list \(pick 1\)/)
  assert.match(all, /backup 1: A3qhJbqA--k can't be looked up \(Video unavailable\)/)
  assert.match(all, /backup 2: zzzzzzzzzzz wasn't in your searches or lookups/)
  assert.match(all, /the list has 4 videos; give exactly 3/)
  assert.match(all, /there are 5 backups; give at most 3/)
})

const video = (videoId: string, durationS: number | null = 100, sourceId: string | null = null): ShortlistVideo => ({
  videoId,
  url: `https://www.youtube.com/watch?v=${videoId}`,
  title: videoId,
  channel: "c",
  durationS,
  views: 1,
  uploadDate: null,
  thumbnail: null,
  part: "p",
  why: "w",
  moments: [],
  addedBy: "agent",
  sourceId: sourceId as ShortlistVideo["sourceId"]
})
const approved: Shortlist = {
  idea: "i",
  summary: "s",
  searches: [],
  picks: [video("Si0P5CmgiwU", 481, "a"), video("XMkilsT2Ahs", 103, "b"), video("jP4vNf1VvJE", 198, "c")],
  backups: [],
  replacing: null
}

test("replacing one spot keeps the other videos where they were and never brings the old one back", () => {
  const replacing = { previous: approved, videoId: "XMkilsT2Ahs" }
  const good = checkShortlist(list(["Si0P5CmgiwU", "kxPGFEuhT4o", "jP4vNf1VvJE"]), context({ replacing }))
  assert.deepEqual(good.problems, [])
  assert.deepEqual(good.value.picks.map((p) => p.sourceId), ["a", null, "c"], "kept videos keep their library ids")
  const moved = checkShortlist(list(["kxPGFEuhT4o", "Si0P5CmgiwU", "XMkilsT2Ahs"]), context({ replacing }))
  assert.match(moved.problems.join("\n"), /pick 1 must stay "Si0P5CmgiwU"/)
  assert.match(moved.problems.join("\n"), /pick 3: "Walking Cotton Ball" is the video being replaced/)
})

test("your changed list: 2–10 videos, none twice, none over 20 minutes, at most 3 backups", () => {
  assert.deepEqual(checkShortlistEdit(approved), [])
  const one = { ...approved, picks: [approved.picks[0]!] }
  assert.deepEqual(checkShortlistEdit(one), ["Keep at least 2 videos; the list has 1."])
  const bad = { ...approved, picks: [...approved.picks, video("Si0P5CmgiwU"), video("jBR63No8O7s", 3901)], backups: [video("a1a1a1a1a1a"), video("b2b2b2b2b2b"), video("c3c3c3c3c3c"), video("d4d4d4d4d4d")] }
  const problems = checkShortlistEdit(bad).join("\n")
  assert.match(problems, /"Si0P5CmgiwU" is on the list twice/)
  assert.match(problems, /"jBR63No8O7s" is 1:05:01 long/)
  assert.match(problems, /Keep at most 3 backups/)
  assert.match(checkShortlistEdit({ ...approved, picks: Array.from({ length: 11 }, (_, i) => video(`v${String(i).padStart(10, "0")}`)) }).join(), /up to 10 videos; the list has 11/)
})
