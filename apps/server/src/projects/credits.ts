import { type ArtifactOwner, CutPlan, type Project, RankingPlan, rankingEntries, Script, ShotPlan } from "@viral/contracts"
import { Effect, Option, Schema } from "effect"
import type { Artifacts } from "../artifacts/artifacts.ts"

type Credited = { readonly rights: string; readonly channel: string | null }

// The clips of a short's approved plan, as far as credits care: which video each plays from (absent = V1).
export type CreditPlan =
  | { readonly _tag: "Narrated"; readonly plan: Pick<ShotPlan, "shots" | "inserts" | "outro"> }
  | { readonly _tag: "Cut"; readonly plan: Pick<CutPlan, "sections"> }
  | { readonly _tag: "Ranking"; readonly plan: Pick<RankingPlan, "entries" | "order"> }

// The short's videos (positions, V1 = 0) in the order their footage first appears on it: a narrated short's shots,
// real lines and outro by where they play (a real line plays after its word, the outro last), a cut-down short's
// sections as they play.
export const appearanceOrder = (credit: CreditPlan): ReadonlyArray<number> => {
  if (credit._tag === "Ranking") {
    // entries play in the plan's order, each from its own video
    const byRank = new Map(credit.plan.entries.map((e) => [e.rank, e.source ?? 0]))
    return [...new Set(credit.plan.order.flatMap((rank) => byRank.get(rank) ?? []))]
  }
  const clips = credit._tag === "Cut"
    ? credit.plan.sections.map((s, i) => ({ at: i, source: s.source ?? 0 }))
    : [
      ...credit.plan.shots.map((s) => ({ at: s.word, source: s.source ?? 0 })),
      ...credit.plan.inserts.map((r) => ({ at: r.afterWord + 0.5, source: r.source ?? 0 })),
      ...credit.plan.outro.map((r, i) => ({ at: Number.MAX_SAFE_INTEGER + i, source: r.source ?? 0 }))
    ]
  return [...new Set([...clips].sort((a, b) => a.at - b.at).map((c) => c.source))]
}

// Who a short credits: each channel whose footage it uses and isn't yours ("I made it" videos get no credit), once,
// in the order its footage first appears (`order`: positions from appearanceOrder). Without a plan yet (`order`
// null), every video of the short in V order. A video with no channel can't be credited by name.
export const creditedChannels = (sources: ReadonlyArray<Credited>, order: ReadonlyArray<number> | null = null) => {
  const used = order === null ? sources : order.flatMap((i) => sources[i] ?? [])
  return [...new Set(used.flatMap((s) => s.rights !== "owned" && s.channel !== null ? [s.channel] : []))]
}

// The credit line drawn on a short: "Video: NileBlue", or "Video: NileBlue · Mark Rober" across videos; null when
// there's no one to credit.
export const creditLine = (sources: ReadonlyArray<Credited>, order: ReadonlyArray<number> | null = null) => {
  const channels = creditedChannels(sources, order)
  return channels.length === 0 ? null : `Video: ${channels.join(" · ")}`
}

// The order a short's videos first appear in, from its latest plan (the shot plan, or a cut-down short's sections);
// null before there's one.
export const loadAppearanceOrder = Effect.fn("loadAppearanceOrder")(function*(project: Project, artifacts: Artifacts["Service"]) {
  const owner: ArtifactOwner = { _tag: "Project", id: project.id }
  if (project.format === "ranking") {
    const plan = Option.flatMap(yield* artifacts.latest(owner, "ranking-plan"), (a) => Schema.decodeUnknownOption(RankingPlan)(a.data))
    return Option.match(plan, { onNone: () => null, onSome: (p) => appearanceOrder({ _tag: "Ranking", plan: p }) })
  }
  if (project.format === "cut-down") {
    const plan = Option.flatMap(yield* artifacts.latest(owner, "cut-plan"), (a) => Schema.decodeUnknownOption(CutPlan)(a.data))
    return Option.match(plan, { onNone: () => null, onSome: (p) => appearanceOrder({ _tag: "Cut", plan: p }) })
  }
  const plan = Option.flatMap(yield* artifacts.latest(owner, "shot-plan"), (a) => Schema.decodeUnknownOption(ShotPlan)(a.data))
  return Option.match(plan, { onNone: () => null, onSome: (p) => appearanceOrder({ _tag: "Narrated", plan: p }) })
})

// A ranking's sources list for the description: each rank with its label, channel and link, #1 first ("#1 Horse who
// gave up: The Dodo, https://…"). Your own footage is listed without a channel.
export const rankingSources = (
  plan: { readonly entries: ReadonlyArray<Pick<RankingPlan["entries"][number], "rank" | "label" | "source">> },
  sources: ReadonlyArray<Credited & { readonly url: string | null; readonly title: string | null }>
) =>
  [...plan.entries].sort((a, b) => a.rank - b.rank).map((entry) => {
    const source = sources[entry.source ?? 0]
    const by = source === undefined ? [] : creditedChannels([source])
    const parts = [...by, ...(source?.url === null || source?.url === undefined ? [] : [source.url])]
    return `#${entry.rank} ${entry.label}${parts.length === 0 ? "" : `: ${parts.join(", ")}`}`
  })

// A narrated ranking's entries as the sources list wants them: each rank, its video (the one its real lines come from)
// and that video's title as the label. Entries with no real line are left out.
export const narratedRankingEntries = (
  script: Script,
  count: number,
  sources: ReadonlyArray<{ readonly title: string | null }>
): ReadonlyArray<Pick<RankingPlan["entries"][number], "rank" | "label" | "source">> =>
  rankingEntries(script.beats, count).entries.flatMap((entry) => {
    const real = script.beats.slice(entry.start, entry.end).find((b) => b._tag === "Real")
    if (real?._tag !== "Real") return []
    const source = real.source ?? 0
    return [{ rank: entry.rank, label: sources[source]?.title ?? `Video ${source + 1}`, ...(real.source === undefined ? {} : { source: real.source }) }]
  })

// The latest ranking plan's sources list (a narrated ranking's from its script), or none for other shorts (and before
// there's a plan).
export const loadRankingSources = Effect.fn("loadRankingSources")(function*(
  project: Project,
  artifacts: Artifacts["Service"],
  sources: ReadonlyArray<Credited & { readonly url: string | null; readonly title: string | null }>
) {
  if (project.approach === "narrated-ranking") {
    const script = Option.flatMap(yield* artifacts.latest({ _tag: "Project", id: project.id }, "script"), (a) => Schema.decodeUnknownOption(Script)(a.data))
    return Option.match(script, {
      onNone: () => null,
      onSome: (s) => {
        const entries = narratedRankingEntries(s, project.sourceIds.length, sources)
        return entries.length === 0 ? null : rankingSources({ entries }, sources)
      }
    })
  }
  if (project.format !== "ranking") return null
  const plan = Option.flatMap(yield* artifacts.latest({ _tag: "Project", id: project.id }, "ranking-plan"), (a) => Schema.decodeUnknownOption(RankingPlan)(a.data))
  return Option.match(plan, { onNone: () => null, onSome: (p) => rankingSources(p, sources) })
})
