import type { Usage } from "@viral/contracts"
import { DateTime } from "effect"

// One stage run as the usage page sees it.
export interface UsageRow {
  readonly stage: string
  readonly status: string
  readonly model: string | null
  readonly costUsd: number | null
  readonly ttsCharacters: number | null
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  // ISO time the stage run started
  readonly startedAt: string
  readonly projectId: string | null
  readonly projectTitle: string | null
}

const DAY_MS = 86_400_000
// the UTC day (YYYY-MM-DD) of an epoch millisecond
export const dayKey = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms)).slice(0, 10)
const dayOf = (iso: string) => iso.slice(0, 10)
const round = (usd: number) => Math.round(usd * 1e6) / 1e6

// Adds up the stage runs of the last `days` days (ending `today`, a YYYY-MM-DD) for Settings › Usage: totals,
// every day of the period (empty days too), the shorts that cost most, and what each step cost.
export const summarizeUsage = (rows: ReadonlyArray<UsageRow>, days: number, today: string): Usage => {
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
    byStage
  }
}
