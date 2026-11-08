import type { Usage } from "@viral/contracts"
import { DateTime } from "effect"

// One stage run as the usage page sees it.
export interface UsageRow {
  readonly stage: string
  readonly status: string
  readonly model: string | null
  // who ran it (claude-cli, ai-gateway, elevenlabs) and whether its cost is real money; null for older runs
  readonly provider: string | null
  readonly billing: "billed" | "subscription" | null
  readonly costUsd: number | null
  readonly ttsCharacters: number | null
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  // ISO time the stage run started
  readonly startedAt: string
  readonly projectId: string | null
  readonly projectTitle: string | null
}

// One eval run (cli eval) as the usage page sees it.
export interface EvalUsageRow {
  readonly model: string
  readonly provider: string
  readonly billing: "billed" | "subscription" | null
  readonly costUsd: number
  // ISO time it was recorded
  readonly createdAt: string
}

// One "Try a line" preview: ElevenLabs characters spoken outside any short.
export interface PreviewUsageRow {
  readonly model: string
  readonly characters: number
  // ISO time it was spoken
  readonly createdAt: string
}

const DAY_MS = 86_400_000
// the UTC day (YYYY-MM-DD) of an epoch millisecond
export const dayKey = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms)).slice(0, 10)
const dayOf = (iso: string) => iso.slice(0, 10)
const round = (usd: number) => Math.round(usd * 1e6) / 1e6

// Adds up the stage runs of the last `days` days (ending `today`, a YYYY-MM-DD) for Settings › Usage: totals,
// every day of the period (empty days too), the shorts that cost most, what each step cost, and ElevenLabs'
// characters (voice takes and previews) by day, model and short.
export const summarizeUsage = (
  rows: ReadonlyArray<UsageRow>,
  days: number,
  today: string,
  evalRows: ReadonlyArray<EvalUsageRow> = [],
  previewRows: ReadonlyArray<PreviewUsageRow> = []
): Usage => {
  const end = Date.parse(`${today}T00:00:00Z`)
  const dayKeys = Array.from({ length: days }, (_, i) => dayKey(end - (days - 1 - i) * DAY_MS))
  const inPeriod = rows.filter((r) => dayKeys.includes(dayOf(r.startedAt)))

  const cost = (r: UsageRow) => r.costUsd ?? 0
  const chars = (r: UsageRow) => r.ttsCharacters ?? 0
  const sum = (list: ReadonlyArray<UsageRow>, f: (r: UsageRow) => number) => list.reduce((n, r) => n + f(r), 0)

  const byDay = dayKeys.map((day) => {
    const list = inPeriod.filter((r) => dayOf(r.startedAt) === day)
    return { day, costUsd: round(sum(list, cost)), ttsCharacters: sum(list, chars) }
  })

  const projects = new Map<string, { title: string; rows: Array<UsageRow> }>()
  for (const r of inPeriod) {
    if (r.projectId === null) continue
    const entry = projects.get(r.projectId) ?? { title: r.projectTitle ?? "Untitled short", rows: [] }
    entry.rows.push(r)
    projects.set(r.projectId, entry)
  }
  const byShort = [...projects.entries()]
    .map(([projectId, { title, rows }]) => ({ projectId, title, costUsd: round(sum(rows, cost)), ttsCharacters: sum(rows, chars) }))
    .filter((s) => s.costUsd > 0 || s.ttsCharacters > 0)
    .sort((a, b) => b.costUsd - a.costUsd || b.ttsCharacters - a.ttsCharacters)

  const stages = new Map<string, Array<UsageRow>>()
  for (const r of inPeriod) stages.set(r.stage, [...(stages.get(r.stage) ?? []), r])
  const byStage = [...stages.entries()]
    .map(([stage, list]) => {
      const models = new Map<string, number>()
      for (const r of list) if (r.model !== null) models.set(r.model, (models.get(r.model) ?? 0) + 1)
      const model = [...models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
      // reused stages did no work; they're not runs that cost anything
      const ran = list.filter((r) => r.status !== "reused")
      return { stage, model, runs: ran.length, costUsd: round(sum(list, cost)), ttsCharacters: sum(list, chars) }
    })
    .filter((s) => s.runs > 0)
    .sort((a, b) => b.costUsd - a.costUsd || b.ttsCharacters - a.ttsCharacters)

  // a short counts once it has a render in the period; its cost is all its stage runs in the period
  const rendered = new Set(inPeriod.filter((r) => r.stage === "render" && r.status === "succeeded" && r.projectId !== null).map((r) => r.projectId))
  const renderedCost = sum(inPeriod.filter((r) => r.projectId !== null && rendered.has(r.projectId)), cost)

  // real money, a CLI plan's value, and costs recorded before billing was tracked
  const billing = {
    billedUsd: round(sum(inPeriod.filter((r) => r.billing === "billed"), cost)),
    subscriptionUsd: round(sum(inPeriod.filter((r) => r.billing === "subscription"), cost)),
    unknownUsd: round(sum(inPeriod.filter((r) => r.billing === null), cost))
  }

  // the runs that did work (not reused) and either cost something or spoke something
  const spent = inPeriod.filter((r) => r.status !== "reused" && (cost(r) > 0 || chars(r) > 0))
  const providers = new Map<string, Array<UsageRow>>()
  for (const r of spent) {
    const key = `${r.provider ?? "unknown"}|${r.billing ?? ""}`
    providers.set(key, [...(providers.get(key) ?? []), r])
  }
  const byProvider = [...providers.entries()]
    .map(([key, list]) => {
      const [provider = "unknown", bill = ""] = key.split("|")
      return {
        provider,
        billing: bill === "" ? null : bill as "billed" | "subscription",
        runs: list.length,
        costUsd: round(sum(list, cost)),
        ttsCharacters: sum(list, chars)
      }
    })
    .sort((a, b) => b.costUsd - a.costUsd || b.ttsCharacters - a.ttsCharacters)

  const models = new Map<string, Array<UsageRow>>()
  for (const r of spent) if (r.model !== null) models.set(r.model, [...(models.get(r.model) ?? []), r])
  const byModel = [...models.entries()]
    .map(([model, list]) => ({
      model,
      provider: list.find((r) => r.provider !== null)?.provider ?? null,
      runs: list.length,
      costUsd: round(sum(list, cost)),
      inputTokens: sum(list, (r) => r.inputTokens ?? 0),
      outputTokens: sum(list, (r) => r.outputTokens ?? 0)
    }))
    .sort((a, b) => b.costUsd - a.costUsd)

  const evalsInPeriod = evalRows.filter((r) => dayKeys.includes(dayOf(r.createdAt)))
  const evalSum = (list: ReadonlyArray<EvalUsageRow>) => list.reduce((n, r) => n + r.costUsd, 0)
  const evalModels = new Map<string, Array<EvalUsageRow>>()
  for (const r of evalsInPeriod) evalModels.set(r.model, [...(evalModels.get(r.model) ?? []), r])
  const evals = {
    costUsd: round(evalSum(evalsInPeriod)),
    billedUsd: round(evalSum(evalsInPeriod.filter((r) => r.billing === "billed"))),
    subscriptionUsd: round(evalSum(evalsInPeriod.filter((r) => r.billing === "subscription"))),
    runs: evalsInPeriod.length,
    byModel: [...evalModels.entries()]
      .map(([model, list]) => ({ model, provider: list[0]!.provider, runs: list.length, costUsd: round(evalSum(list)) }))
      .sort((a, b) => b.costUsd - a.costUsd)
  }

  // ElevenLabs: every take that spoke (reused stages spoke nothing) plus the previews, in characters
  const takes = inPeriod.filter((r) => r.status !== "reused" && chars(r) > 0)
  const previews = previewRows.filter((p) => dayKeys.includes(dayOf(p.createdAt)))
  const previewChars = previews.reduce((n, p) => n + p.characters, 0)
  const ttsModels = new Map<string, { characters: number; takes: number; previews: number }>()
  const addModel = (model: string, characters: number, take: boolean) => {
    const entry = ttsModels.get(model) ?? { characters: 0, takes: 0, previews: 0 }
    ttsModels.set(model, {
      characters: entry.characters + characters,
      takes: entry.takes + (take ? 1 : 0),
      previews: entry.previews + (take ? 0 : 1)
    })
  }
  for (const r of takes) addModel(r.model ?? "unknown", chars(r), true)
  for (const p of previews) addModel(p.model, p.characters, false)
  const ttsShorts = new Map<string, { title: string; characters: number; takes: number }>()
  for (const r of takes) {
    if (r.projectId === null) continue
    const entry = ttsShorts.get(r.projectId) ?? { title: r.projectTitle ?? "Untitled short", characters: 0, takes: 0 }
    ttsShorts.set(r.projectId, { title: entry.title, characters: entry.characters + chars(r), takes: entry.takes + 1 })
  }
  const elevenLabs = {
    characters: sum(takes, chars) + previewChars,
    takes: takes.length,
    previews: previews.length,
    previewCharacters: previewChars,
    byDay: dayKeys.map((day) => ({
      day,
      characters: sum(takes.filter((r) => dayOf(r.startedAt) === day), chars) +
        previews.filter((p) => dayOf(p.createdAt) === day).reduce((n, p) => n + p.characters, 0)
    })),
    byModel: [...ttsModels.entries()].map(([model, m]) => ({ model, ...m })).sort((a, b) => b.characters - a.characters),
    byShort: [...ttsShorts.entries()].map(([projectId, s]) => ({ projectId, ...s })).sort((a, b) => b.characters - a.characters)
  }

  return {
    days,
    totals: {
      costUsd: round(sum(inPeriod, cost)),
      ttsCharacters: sum(inPeriod, chars),
      inputTokens: sum(inPeriod, (r) => r.inputTokens ?? 0),
      outputTokens: sum(inPeriod, (r) => r.outputTokens ?? 0),
      shorts: rendered.size,
      costPerShortUsd: rendered.size === 0 ? null : round(renderedCost / rendered.size)
    },
    byDay,
    byShort,
    byStage,
    billing,
    byProvider,
    byModel,
    elevenLabs,
    evals
  }
}
