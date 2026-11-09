import { type ArtifactOwner, CutPlan, type Project, ShotPlan } from "@viral/contracts"
import { Effect, Option, Schema } from "effect"
import type { Artifacts } from "../artifacts/artifacts.ts"

type Credited = { readonly rights: string; readonly channel: string | null }

// The clips of a short's approved plan, as far as credits care: which video each plays from (absent = V1).
export type CreditPlan =
  | { readonly _tag: "Narrated"; readonly plan: Pick<ShotPlan, "shots" | "inserts" | "outro"> }
  | { readonly _tag: "Cut"; readonly plan: Pick<CutPlan, "sections"> }

// The short's videos (positions, V1 = 0) in the order their footage first appears on it: a narrated short's shots,
// real lines and outro by where they play (a real line plays after its word, the outro last), a cut-down short's
// sections as they play.
export const appearanceOrder = (credit: CreditPlan): ReadonlyArray<number> => {
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
  if (project.format === "cut-down") {
    const plan = Option.flatMap(yield* artifacts.latest(owner, "cut-plan"), (a) => Schema.decodeUnknownOption(CutPlan)(a.data))
    return Option.match(plan, { onNone: () => null, onSome: (p) => appearanceOrder({ _tag: "Cut", plan: p }) })
  }
  const plan = Option.flatMap(yield* artifacts.latest(owner, "shot-plan"), (a) => Schema.decodeUnknownOption(ShotPlan)(a.data))
  return Option.match(plan, { onNone: () => null, onSome: (p) => appearanceOrder({ _tag: "Narrated", plan: p }) })
})
