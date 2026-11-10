import type { Project, Run, RunId, Source, StageRun, VideoSet, WaitingItem } from "@viral/contracts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { emptyProgress } from "../videos/run-progress.ts"
import type { Overview } from "./overview.ts"
import { filterRows, liveStage, recentRows, statusChip, tabCounts } from "./recents-values.ts"

const time = (minutesAgo: number) => ({ epochMilliseconds: Date.UTC(2026, 10, 10, 12) - minutesAgo * 60_000 })
const run = (id: string, status: Run["status"], minutesAgo: number) => ({ id: id as RunId, status, startedAt: time(minutesAgo) }) as unknown as Run

const CANDY = { id: "candy", title: "He made the world's most extreme candy", channel: "NileBlue", createdAt: time(900) } as unknown as Source
const HEIDI = { id: "heidi", title: "Heidi Klum's 25th Halloween party", channel: "Associated Press", createdAt: time(900) } as unknown as Source
const PODCAST = { id: "pod", title: "One habit that changed my mornings", channel: "Pod", createdAt: time(30) } as unknown as Source

const project = (id: string, title: string, format: Project["format"], sourceIds: ReadonlyArray<string>, minutesAgo: number) =>
  ({ id, title, format, sourceIds, createdAt: time(minutesAgo) }) as unknown as Project
const short = (p: Project, latestRun: Run | null, thumb: string | null = `/t/${p.id}.jpg`) =>
  ({ project: p, latestRun, thumb, sourceTitle: null, status: { tone: "neutral", label: "" }, durationS: null }) as Overview["shorts"][number]
const video = (source: Source, latestRun: Run | null, proposals: number, shortCount = 0) =>
  ({ source, latestRun, proposals, shortCount, thumb: `/v/${source.id}.jpg`, status: { tone: "neutral", label: "" } }) as Overview["videos"][number]
const set = (id: string, title: string, sourceIds: ReadonlyArray<string>, research: boolean, latestRun: Run | null, proposals: number) => ({
  set: { id, title, sourceIds, research: research ? { idea: title, videos: 5, length: "180" } : null, createdAt: time(600) } as unknown as VideoSet,
  latestRun,
  proposals,
  thumbs: sourceIds.map((s) => `/v/${s}.jpg`)
})
const gate = (stage: string, ids: { projectId?: string; setId?: string; sourceId?: string }) =>
  ({ request: { stage }, projectId: ids.projectId ?? null, setId: ids.setId ?? null, sourceId: ids.sourceId ?? null }) as unknown as WaitingItem

const overview: Pick<Overview, "shorts" | "setSummaries" | "videos" | "waiting"> = {
  shorts: [
    short(project("p1", "How Far Would You Go?", "narrated", ["candy", "heidi"], 400), run("r1", "waiting", 18)),
    short(project("p2", "What Happens When One Candy Hits Every Taste?", "narrated", ["candy"], 500), run("r2", "running", 60)),
    short(project("p3", "He Packed 7 Tastes Into 1 Candy", "narrated", ["candy"], 3000), run("r3", "completed", 1500)),
    short(project("p4", "Top 5 Animal Rescue Comebacks", "ranking", ["candy"], 100), null, null)
  ],
  setSummaries: [
    set("s1", "Extreme creations", ["candy", "heidi"], false, run("r5", "completed", 120), 3),
    set("s2", "Top 5 animal rescue comebacks", [], true, run("r6", "waiting", 2), 0)
  ],
  videos: [video(CANDY, run("r7", "completed", 900), 3, 3), video(HEIDI, run("r8", "completed", 900), 0), video(PODCAST, run("r9", "running", 5), 0)],
  waiting: [gate("script", { projectId: "p1", sourceId: "candy" }), gate("research", { setId: "s2" })]
}

test("recents hold shorts, video sets and the videos not in a set, newest first", () => {
  const rows = recentRows(overview)
  assert.deepEqual(rows.map((r) => r.key), ["set:s2", "video:pod", "short:p1", "short:p2", "short:p4", "set:s1", "short:p3"])
  const byKey = new Map(rows.map((r) => [r.key, r]))
  // a short names its format and its videos by short name
  assert.equal(byKey.get("short:p1")!.sub, "Narrated · Extreme candy + Heidi Klum's")
  assert.equal(byKey.get("short:p4")!.sub, "Ranking · Extreme candy")
  assert.deepEqual(byKey.get("short:p4")!.thumbs, [])
  // a set says how many videos and where they came from; a research set counts the videos it's looking for
  assert.equal(byKey.get("set:s1")!.sub, "Video set · 2 videos")
  assert.equal(byKey.get("set:s2")!.sub, "Video set · 5 videos · from an idea")
  assert.equal(byKey.get("video:pod")!.sub, "Video · Pod")
  // never made: when it was created
  assert.equal(byKey.get("short:p4")!.at, time(100).epochMilliseconds)
  // where each opens: a waiting short at its step
  assert.deepEqual(byKey.get("short:p1")!.target, { _tag: "Short", projectId: "p1", stage: "script" })
  assert.deepEqual(byKey.get("set:s2")!.target, { _tag: "Set", setId: "s2" })
})

test("each row's status chip reads like the mockup", () => {
  const rows = new Map(recentRows(overview).map((r) => [r.key, r]))
  const chip = (key: string, live: Parameters<typeof statusChip>[1] = null, compact = false) => statusChip(rows.get(key)!.status, live, compact)
  assert.deepEqual(chip("short:p1"), { tone: "wait", label: "Waiting for you · Script" })
  assert.deepEqual(chip("short:p1", null, true), { tone: "wait", label: "Waiting · Script" })
  assert.deepEqual(chip("set:s2"), { tone: "wait", label: "Waiting for you · Shortlist" })
  // a running short shows its step, and Rendering with a % once its run is followed live
  assert.deepEqual(chip("short:p2"), { tone: "run", label: "Working" })
  assert.deepEqual(chip("short:p2", { stage: "render", pct: 62.4 }), { tone: "run", label: "Rendering · 62%" })
  assert.deepEqual(chip("short:p2", { stage: "voice", pct: null }), { tone: "run", label: "Voice" })
  assert.deepEqual(chip("short:p3"), { tone: "ok", label: "Published" })
  assert.deepEqual(chip("short:p4"), { tone: "neutral", label: "Not started" })
  assert.deepEqual(chip("set:s1"), { tone: "ok", label: "3 shorts suggested" })
  assert.deepEqual(chip("video:pod"), { tone: "run", label: "Reading" })
})

test("tabs, the status filter and search narrow the list", () => {
  const rows = recentRows(overview)
  const keys = (opts: Parameters<typeof filterRows>[1]) => filterRows(rows, opts).map((r) => r.key)
  assert.deepEqual(keys({ tab: "short", status: null, query: "" }), ["short:p1", "short:p2", "short:p4", "short:p3"])
  assert.deepEqual(keys({ tab: "set", status: null, query: "" }), ["set:s2", "set:s1"])
  assert.deepEqual(keys({ tab: "all", status: "waiting", query: "" }), ["set:s2", "short:p1"])
  assert.deepEqual(keys({ tab: "all", status: "running", query: "" }), ["video:pod", "short:p2"])
  assert.deepEqual(keys({ tab: "all", status: "suggested", query: "" }), ["set:s1"])
  assert.deepEqual(keys({ tab: "all", status: "published", query: "" }), ["short:p3"])
  // every word, in the title or the line under it, any case
  assert.deepEqual(keys({ tab: "all", status: null, query: "  CANDY  every " }), ["short:p2"])
  assert.deepEqual(keys({ tab: "all", status: null, query: "heidi" }), ["short:p1"])
  assert.deepEqual(keys({ tab: "short", status: null, query: "ranking" }), ["short:p4"])
  assert.deepEqual(tabCounts(rows, null), { all: 7, short: 4, set: 2 })
  assert.deepEqual(tabCounts(rows, "waiting"), { all: 2, short: 1, set: 1 })
})

test("a live run says which step it's on and how far", () => {
  const stage = (stageName: string, status: StageRun["status"], attempt = 1) => ({ id: `${stageName}${attempt}`, stage: stageName, status, attempt }) as unknown as StageRun
  assert.equal(liveStage(emptyProgress), null)
  assert.deepEqual(
    liveStage({ ...emptyProgress, stages: [stage("voice", "succeeded"), stage("render", "running")], live: { render: { pct: 40, message: null } } }),
    { stage: "render", pct: 40 }
  )
  // a stage that failed then ran again is running
  assert.deepEqual(liveStage({ ...emptyProgress, stages: [stage("shots", "failed"), stage("shots", "running", 2)] }), { stage: "shots", pct: null })
})
