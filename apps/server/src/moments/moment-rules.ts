import {
  type ProposedRanking,
  RANKING_LIMITS,
  type RankingFraming,
  type RankingPlan,
  type RankingProposal,
  type RankingRole,
  type SourceIndex,
  type TranscriptWord
} from "@viral/contracts"
import type { Checked } from "../agent-session/run-checked.ts"
import { clipSource, type SourceContext, sourceField } from "../projects/source-context.ts"
import { sentencesOf, snapToSentences } from "../transcribe/sentences.ts"

// One of a ranking's videos as the checks see it: its words, length and excluded ranges, and the framing Viral
// detected for it (null when it couldn't tell).
export interface RankingVideo extends SourceContext {
  readonly framing: RankingFraming | null
}

export interface RankingContext {
  // the short's videos, V1 first
  readonly videos: ReadonlyArray<RankingVideo>
  // the longest the ranking may be once snapped (the length you chose: 60 s, else the 3-minute Shorts limit)
  readonly maxSeconds: number
  // the framing Viral detected at a shot's moment (videos often mix landscape footage and upright phone footage in
  // one file), by the shot's video and its times as proposed; null or absent = the video's own
  readonly framingAt?: (source: number, start: number, end: number) => RankingFraming | null
}

// The key a detected framing is kept under for a shot.
export const framingKey = (source: number, start: number, end: number) => `${source}:${start}-${end}`

// A ranking before its frames are drawn: every shot snapped to whole sentences, its framing settled and its words.
export type RankingDraft = Omit<RankingPlan, "storyboard" | "warnings" | "entries"> & {
  readonly entries: ReadonlyArray<
    Omit<RankingPlan["entries"][number], "shots"> & {
      readonly shots: ReadonlyArray<Omit<RankingPlan["entries"][number]["shots"][number], "firstFrame" | "lastFrame">>
    }
  >
}

const round = (t: number) => Math.round(t * 1000) / 1000

// ---------------------------------------------------------------- play order

// A small seeded generator, so the same ranking always shuffles the same way (and "Shuffle again" moves the seed).
const generator = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// A shuffled play order with #1 last, building to it the way the reference does (…, 3, 2, 1 for a long list, …, 2, 1
// for a medium one): 7, 10, 5, 9, 4, 8, 6, 3, 2, 1.
export const shuffledOrder = (ranks: ReadonlyArray<number>, seed: number): ReadonlyArray<number> => {
  const sorted = [...new Set(ranks)].sort((a, b) => a - b)
  const n = sorted.length
  const tailSize = n >= 8 ? 3 : n >= 4 ? 2 : 1
  const tail = sorted.slice(0, tailSize).reverse()
  const rest = sorted.slice(tailSize)
  const random = generator(seed)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j]!, rest[i]!]
  }
  // never plain counting down (or up): that's no shuffle
  if (rest.length > 2 && rest.every((r, i) => i === 0 || r < rest[i - 1]!)) rest.push(rest.shift()!)
  if (rest.length > 2 && rest.every((r, i) => i === 0 || r > rest[i - 1]!)) rest.push(rest.shift()!)
  return [...rest, ...tail]
}

// The seed a ranking shuffles with by default: its labels, so a new ranking gets a new order.
export const orderSeed = (labels: ReadonlyArray<string>) =>
  [...labels.join("|")].reduce((h, c) => Math.imul(h ^ c.codePointAt(0)!, 16777619) >>> 0, 2166136261)

// The agent's ranking (each entry's video by its V number) as it's checked and stored (by position; V1 left out),
// with a shuffled play order when it gave none.
export const fromProposedRanking = (proposed: ProposedRanking): RankingProposal => {
  const entries = proposed.entries.map(({ video, shots, ...entry }) => ({
    ...entry,
    ...sourceField(video === undefined ? undefined : (video - 1) as SourceIndex),
    shots: shots.map(({ framesChecked: _checked, ...shot }) => shot)
  }))
  const order = proposed.order ?? shuffledOrder(entries.map((e) => e.rank), orderSeed(entries.map((e) => e.label)))
  return { title: proposed.title, entries, order }
}

// ---------------------------------------------------------------- the checks

const ROLE_ORDER: Record<RankingRole, number> = { before: 0, care: 1, after: 2 }
const fmt = (t: number) => t.toFixed(1)
const graphemes = (text: string) => [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)].length
const isEmoji = (text: string) => graphemes(text) === 1 && /\p{Extended_Pictographic}/u.test(text)

// The ranking's whole length: every shot of every entry.
export const totalSeconds = (entries: ReadonlyArray<{ readonly shots: ReadonlyArray<{ readonly start: number; readonly end: number }> }>) =>
  entries.reduce((n, e) => n + e.shots.reduce((m, s) => m + Math.max(0, s.end - s.start), 0), 0)

// Checks a ranking against its videos (V1 first) and snaps every shot to whole sentences of its own video, adding
// the words it says: ranks 1…N once each, one video per entry, before → care → after shots inside the video and out
// of its excluded ranges, starting 0.4 s in or later, #1 longest and played last, labels short with one emoji, and
// the whole ranking within the length you chose. The renderer plays the snapped times as they are.
export const checkRanking = (proposal: RankingProposal, context: RankingContext): Checked<RankingDraft> => {
  const problems: Array<string> = []
  const { videos, maxSeconds } = context
  const several = videos.length > 1
  const videoName = (source: number | undefined) => several ? `V${(source ?? 0) + 1}` : "the video"
  const L = RANKING_LIMITS

  const lead = proposal.title.lead
  const accent = proposal.title.accent.trim()
  if (accent === "") problems.push("the title needs its accent word (\"Comebacks\" in \"Ranking Animal Comebacks\")")
  if (`${lead}${accent}`.trim().length > L.titleChars) {
    problems.push(`the title "${lead}${accent}" is ${`${lead}${accent}`.trim().length} characters; keep it to ${L.titleChars} so it fits on one line`)
  }

  const n = proposal.entries.length
  const fewest = Math.min(L.entries[0], videos.length)
  if (n < Math.max(fewest, 2)) problems.push(`a ranking needs at least ${Math.max(fewest, 2)} entries, not ${n}`)
  if (n > L.entries[1]) problems.push(`a ranking has at most ${L.entries[1]} entries, not ${n}`)
  const ranks = proposal.entries.map((e) => e.rank)
  const expected = Array.from({ length: n }, (_, i) => i + 1)
  if ([...ranks].sort((a, b) => a - b).join(",") !== expected.join(",")) {
    problems.push(`the ranks must be 1–${n}, each once (they're ${ranks.join(", ")})`)
  }
  const usedVideos = new Map<number, number>()
  proposal.entries.forEach((e) => {
    const v = e.source ?? 0
    const other = usedVideos.get(v)
    if (other !== undefined) problems.push(`#${other} and #${e.rank} both come from ${videoName(v)}; a ranking has one entry per video`)
    else usedVideos.set(v, e.rank)
  })

  const entries = proposal.entries.map((entry) => {
    const name = `#${entry.rank} (${entry.label || "no label"})`
    const label = entry.label.trim()
    if (label === "") problems.push(`${name} needs a label`)
    if (label.length > L.labelChars) problems.push(`${name}: the label is ${label.length} characters; keep it to ${L.labelChars}`)
    const emoji = entry.emoji.trim()
    if (!isEmoji(emoji)) problems.push(`${name}: give it exactly one emoji, not "${entry.emoji}"`)
    const found = clipSource(videos, entry.source, name)
    if (found.problem !== null) {
      problems.push(found.problem)
      return { ...entry, label, emoji, shots: entry.shots.map((s) => ({ ...s, framing: s.framing ?? "window" as const, text: "" })) }
    }
    const video = found.source
    const where = videoName(entry.source)
    const count = entry.shots.length
    if (count < L.shots[0] || count > L.shots[1]) {
      problems.push(`${name} has ${count} shot${count === 1 ? "" : "s"}; give it ${L.shots[0]} (before, care, after)${entry.rank === 1 ? ` or ${L.shots[1]}` : ""}`)
    } else if (count > L.shots[0] && entry.rank !== 1) {
      problems.push(`${name} has ${count} shots; only #1 gets a fourth`)
    }
    for (const role of ["before", "care", "after"] as const) {
      if (!entry.shots.some((s) => s.role === role)) problems.push(`${name} has no ${role} shot; each entry is before → care → after`)
    }
    if (entry.shots.some((s, k) => k > 0 && ROLE_ORDER[s.role] < ROLE_ORDER[entry.shots[k - 1]!.role])) {
      problems.push(`${name}: its shots must play before → care → after`)
    }
    const sentences = sentencesOf(video.words)
    const shots = entry.shots.map((shot, k) => {
      const shotName = `${name} shot ${k + 1} (${shot.role}, ${where} ${fmt(shot.start)}–${fmt(shot.end)}s)`
      if (!(shot.end > shot.start)) problems.push(`${shotName} ends before it starts`)
      if (shot.start < L.minStart) problems.push(`${shotName} starts before ${L.minStart}s; videos often fade in from black there`)
      if (shot.end > video.seconds) problems.push(`${shotName} runs past the end of ${where} (${fmt(video.seconds)}s)`)
      if (shot.cropX !== undefined && (shot.cropX < 0 || shot.cropX > 1)) problems.push(`${shotName}: cropX must be 0–1`)
      const snapped = snapToSentences(sentences, shot.start, shot.end, {
        maxBack: L.maxBack,
        maxForward: L.maxForward,
        limit: video.seconds,
        blocked: video.excluded,
        minStart: L.minStart
      })
      if (snapped.problem !== null) {
        problems.push(`${shotName} ${snapped.problem}; move it so both ends fall on whole sentences`)
      }
      if (snapped.end - snapped.start < L.minShot) {
        problems.push(`${shotName} lasts ${fmt(snapped.end - snapped.start)}s once snapped to whole sentences; make it at least ${L.minShot}s`)
      }
      const ad = video.excluded.find((r) => snapped.start < r.end && snapped.end > r.start)
      if (ad !== undefined) problems.push(`${shotName} touches an excluded range of ${where} (${fmt(ad.start)}–${fmt(ad.end)}s: an ad or end screen)`)
      const text = video.words.filter((w) => w.s >= snapped.start - 0.01 && w.e <= snapped.end + 0.01).map((w) => w.w).join(" ")
      return {
        ...shot,
        start: snapped.start,
        end: snapped.end,
        framing: shot.framing ?? context.framingAt?.(entry.source ?? 0, shot.start, shot.end) ?? video.framing ?? "window" as const,
        text
      }
    })
    shots.forEach((a, i) =>
      shots.slice(i + 1).forEach((b, j) => {
        if (a.start < b.end && b.start < a.end) problems.push(`${name}: shots ${i + 1} and ${i + j + 2} overlap`)
      })
    )
    return { ...entry, label, emoji, shots }
  })

  // #1 is the longest entry and plays last
  const seconds = (e: { readonly shots: ReadonlyArray<{ readonly start: number; readonly end: number }> }) => totalSeconds([e])
  const first = entries.find((e) => e.rank === 1)
  if (first !== undefined) {
    const longer = entries.filter((e) => e.rank !== 1 && seconds(e) > seconds(first))
    if (longer.length > 0) {
      problems.push(`#1 runs ${fmt(seconds(first))}s but ${longer.map((e) => `#${e.rank} runs ${fmt(seconds(e))}s`).join(", ")}; #1 is the longest entry (about 20–25s)`)
    }
  }
  if ([...proposal.order].sort((a, b) => a - b).join(",") !== [...ranks].sort((a, b) => a - b).join(",")) {
    problems.push(`the play order must list every rank once (it's ${proposal.order.join(", ")})`)
  } else if (proposal.order.at(-1) !== 1) {
    problems.push("#1 plays last")
  }

  const durationS = round(totalSeconds(entries))
  if (durationS > maxSeconds) {
    problems.push(`the ranking runs ${fmt(durationS)}s once snapped to whole sentences; keep it within ${fmt(maxSeconds)}s (shorten the shots: snapping makes them longer)`)
  }
  return { value: { title: { lead, accent }, entries, order: proposal.order, durationS, maxSeconds }, problems }
}

// The longest a ranking may be: up to 60 s when you chose that, else the Shorts limit.
export const rankingMaxSeconds = (length: "60" | "180" | "any" | null) => length === "60" ? RANKING_LIMITS.seconds[0] : RANKING_LIMITS.seconds[1]
