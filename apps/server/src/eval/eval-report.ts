import { AdRanges, AgentProvider, closingLine, Script, SetStory, ShortMetadata, StoryMap } from "@viral/contracts"
import { Option, Schema } from "effect"
import type { EvalRunResult } from "./eval-runner.ts"
import { EvalStageName } from "./eval-stages.ts"

// What an eval wrote: every run, plus the approved outputs of the fixture to compare against.
export interface EvalReport {
  readonly createdAt: string
  readonly fixture: string
  readonly stages: ReadonlyArray<EvalStageName>
  readonly models: ReadonlyArray<string>
  readonly runs: number
  readonly budgetUsd: number
  readonly spentUsd: number
  readonly results: ReadonlyArray<EvalRunResult>
  // the fixture's approved output per stage (the short's script, the source's story and ads, the set's story)
  readonly reference: Partial<Record<EvalStageName, unknown>>
  // a set fixture's videos, V1 first: how the page names them (a colour dot and a short name, never "V1")
  readonly videos?: ReadonlyArray<{ readonly name: string }>
}

// A report.json as read back (for --include and `eval record`): the fields the summary and recording use.
export const StoredEvalReport = Schema.fromJsonString(Schema.Struct({
  createdAt: Schema.String,
  fixture: Schema.String,
  stages: Schema.Array(EvalStageName),
  models: Schema.Array(Schema.String),
  runs: Schema.Int,
  budgetUsd: Schema.Number,
  spentUsd: Schema.Number,
  results: Schema.Array(Schema.Struct({
    stage: EvalStageName,
    model: Schema.String,
    provider: AgentProvider,
    // reports from before Codex and OpenCode have no billing: the gateway's runs were billed, the CLI's on a plan
    billing: Schema.optional(Schema.Literals(["billed", "subscription"])),
    run: Schema.Int,
    status: Schema.Literals(["passed", "failed", "skipped"]),
    error: Schema.NullOr(Schema.String),
    costUsd: Schema.Number,
    // reports from before direct keys have none (their costs were all reported)
    costBasis: Schema.optional(Schema.NullOr(Schema.Literals(["reported", "estimate", "unknown"]))),
    inputTokens: Schema.Number,
    outputTokens: Schema.Number,
    seconds: Schema.Number,
    reportedModel: Schema.NullOr(Schema.String),
    firstTryPass: Schema.NullOr(Schema.Boolean),
    firstTryProblems: Schema.Array(Schema.String),
    fixRounds: Schema.Int,
    result: Schema.Unknown
  })),
  reference: Schema.Record(Schema.String, Schema.Unknown),
  videos: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String })))
}))

// Adds earlier reports' runs to this one, numbering them first, so one page and one table compare every run.
export const combineReports = (report: EvalReport, earlier: ReadonlyArray<EvalReport>): EvalReport => {
  if (earlier.length === 0) return report
  const videos = report.videos ?? earlier.find((r) => r.videos !== undefined)?.videos
  const all = [...earlier, report]
  const results: Array<EvalRunResult> = []
  const offset = new Map<string, number>()
  for (const r of all) {
    const local = new Map<string, number>()
    for (const result of r.results) {
      const key = `${result.stage}|${result.model}`
      const run = (offset.get(key) ?? 0) + result.run
      local.set(key, Math.max(local.get(key) ?? 0, run))
      results.push({ ...result, run })
    }
    for (const [key, top] of local) offset.set(key, top)
  }
  return {
    ...report,
    stages: [...new Set(all.flatMap((r) => r.stages))],
    models: [...new Set(all.flatMap((r) => r.models))],
    runs: all.reduce((n, r) => n + r.runs, 0),
    budgetUsd: all.reduce((n, r) => n + r.budgetUsd, 0),
    spentUsd: all.reduce((n, r) => n + r.spentUsd, 0),
    results,
    ...(videos === undefined ? {} : { videos })
  }
}

export interface EvalSummaryRow {
  readonly stage: EvalStageName
  readonly model: string
  readonly runs: number
  readonly passed: number
  readonly skipped: number
  readonly firstTryPassed: number
  readonly fixRounds: number
  readonly avgCostUsd: number
  readonly avgTokens: number
  // every run that ran was on a plan (its cost is a plan's value, or nothing for Codex)
  readonly onPlan: boolean
  readonly avgSeconds: number
  // the weakest cost basis of its runs: unknown (some had no price) or estimate (tokens × Viral's prices)
  readonly costBasis: "reported" | "estimate" | "unknown" | null
}

// Per stage and model: how many runs passed, passed first try, the fix rounds they took, and the average cost
// and time of the runs that ran.
export const summarize = (report: EvalReport): ReadonlyArray<EvalSummaryRow> =>
  report.stages.flatMap((stage) =>
    report.models.map((model) => {
      const all = report.results.filter((r) => r.stage === stage && r.model === model)
      const ran = all.filter((r) => r.status !== "skipped")
      const avg = (f: (r: EvalRunResult) => number) => ran.length === 0 ? 0 : ran.reduce((sum, r) => sum + f(r), 0) / ran.length
      return {
        stage,
        model,
        runs: ran.length,
        passed: ran.filter((r) => r.status === "passed").length,
        skipped: all.length - ran.length,
        firstTryPassed: ran.filter((r) => r.firstTryPass === true).length,
        fixRounds: ran.reduce((sum, r) => sum + r.fixRounds, 0),
        avgCostUsd: avg((r) => r.costUsd),
        avgTokens: avg((r) => r.inputTokens + r.outputTokens),
        onPlan: ran.length > 0 && ran.every((r) => r.billing === "subscription"),
        costBasis: ran.some((r) => r.costBasis === "unknown")
          ? "unknown"
          : ran.some((r) => r.costBasis === "estimate")
          ? "estimate"
          : ran.some((r) => r.costBasis === "reported")
          ? "reported"
          : null,
        avgSeconds: avg((r) => r.seconds)
      }
    })
  )

const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 3)}`
const tokens = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k tok` : `${Math.round(n)} tok`

// What a run (or a row's average) cost: dollars, or on a plan the tokens it used (and the plan's value when the CLI
// reports one, as the Claude CLI does).
// A model Viral has no price for shows its tokens and "price unknown", never $0; an estimate from tokens says so.
const costText = (costUsd: number, tokenCount: number, onPlan: boolean, basis: EvalSummaryRow["costBasis"] = null) =>
  basis === "unknown"
    ? `${tokens(tokenCount)} · price unknown`
    : !onPlan
    ? `${usd(costUsd)}${basis === "estimate" ? " est." : ""}`
    : costUsd === 0
    ? `${tokens(tokenCount)} · plan`
    : `${usd(costUsd)} plan value`

export const reportMarkdown = (report: EvalReport): string =>
  [
    `# Eval ${report.createdAt}`,
    "",
    `Fixture **${report.fixture}**, ${report.runs} run(s) each, budget $${report.budgetUsd.toFixed(2)} for priced runs, spent **${usd(report.spentUsd)}**.`,
    "",
    "| stage | model | passed | first try | fix rounds | avg cost | avg time | skipped |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...summarize(report).map((r) =>
      `| ${r.stage} | ${r.model} | ${r.passed}/${r.runs} | ${r.firstTryPassed}/${r.runs} | ${r.fixRounds} | ${costText(r.avgCostUsd, r.avgTokens, r.onPlan, r.costBasis)} | ${r.avgSeconds.toFixed(1)}s | ${r.skipped} |`
    ),
    ""
  ].join("\n")

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`

// Each video's colour, by position: the same hues as the app's set page and timeline (light values).
const VIDEO_COLOURS = ["#4f7fe0", "#e07b32", "#1aa39a", "#8b5cf6", "#d6409f", "#2f9e44", "#c99a06", "#e5484d", "#0e9ad6", "#9c6644"]
type Videos = ReadonlyArray<{ readonly name: string }>

// A video as the page names it: its colour dot and short name ("Video 2" when the report has no names).
const videoChip = (videos: Videos, index: number) =>
  `<span class=video><i style="background:${VIDEO_COLOURS[index % VIDEO_COLOURS.length]}"></i>${escape(videos[index]?.name ?? `Video ${index + 1}`)}</span>`

// An agent's or a check's text with its V labels ("V2's transcript") put as the videos' short names, so the page
// never says V1.
const named = (videos: Videos, text: string) =>
  videos.length === 0 ? text : text.replace(/\bV(\d{1,2})\b/g, (label, n: string) => videos[Number(n) - 1]?.name ?? label)

const SCORE_NAMES: Record<string, string> = {
  openLoop: "open loop",
  completionCompulsion: "completion",
  universalRelatability: "relatable",
  shareability: "shareable"
}

// A set story as you'd judge it: what joins the videos, each video's part, the three proposals side by side with
// the videos each uses, and the beats per video.
const renderSetStory = (s: SetStory, videos: Videos) => {
  const text = (t: string) => escape(named(videos, t))
  return `<p>${text(s.summary)}</p>` +
  `<ul class=parts>${s.videos.map((v) => `<li>${videoChip(videos, v.source)} ${text(v.summary)}${v.missing === undefined ? "" : ` <span class=muted>(missing: ${text(v.missing)})</span>`}</li>`).join("")}</ul>` +
  `<div class=proposals>${s.proposals.map((p, i) =>
    `<div class=proposal><div class=muted>${i + 1} · <span class=tag>${escape(p.approach)}</span></div>` +
    `<p class=headline>${text(p.title)}</p><p>“${text(p.hook)}”</p>` +
    `<div class=uses>${p.sources.map((source) => videoChip(videos, source)).join("")}</div>` +
    `<p class=muted>${text(p.why)}</p>` +
    `<p class=scores>${Object.entries(p.scores).map(([axis, score]) => `${SCORE_NAMES[axis] ?? axis} <b>${score}</b>`).join(" · ")}</p></div>`
  ).join("")}</div>` +
  `<details><summary>${s.beats.length} beats</summary><ul>${s.beats.map((b) =>
    `<li>${videoChip(videos, b.source)} <b>${escape(b.beat)}</b> ${clock(b.start)}–${clock(b.end)}: ${text(b.summary)}${b.quotes.map((q) => `<br><q>${escape(q.text)}</q>`).join("")}</li>`
  ).join("")}</ul></details>`
}

// A stage's output as you'd read it: the parts to judge, not the JSON.
const renderOutput = (stage: EvalStageName, value: unknown, videos: Videos = []): string => {
  const as = <A>(schema: Schema.Decoder<A>) => Schema.decodeUnknownOption(schema)(value)
  const json = () => `<pre>${escape(JSON.stringify(value, null, 2))}</pre>`
  switch (stage) {
    case "ads":
      return Option.match(as(AdRanges), {
        onNone: json,
        onSome: (a) =>
          a.ranges.length === 0
            ? "<p class=muted>No ads found.</p>"
            : `<ul>${a.ranges.map((r) => `<li><b>${clock(r.start)}–${clock(r.end)}</b> ${escape(r.kind)}<br><span class=muted>${escape(r.evidence)}</span></li>`).join("")}</ul>`
      })
    case "story":
      return Option.match(as(StoryMap), {
        onNone: json,
        onSome: (s) =>
          `<p>${escape(s.summary)}</p>` +
          `<h4>Proposals</h4><ol>${s.proposals.map((p) =>
            `<li><b>${escape(p.title)}</b> <span class=tag>${escape(p.approach)}</span><br>“${escape(p.hook)}”<br><span class=muted>${escape(p.why)}</span></li>`
          ).join("")}</ol>` +
          `<details><summary>${s.beats.length} beats</summary><ul>${s.beats.map((b) =>
            `<li><b>${escape(b.beat)}</b> ${clock(b.start)}–${clock(b.end)}: ${escape(b.summary)}${b.quotes.map((q) => `<br><q>${escape(q.text)}</q>`).join("")}</li>`
          ).join("")}</ul></details>`
      })
    case "script":
      return Option.match(as(Script), {
        onNone: json,
        onSome: (s) =>
          (s.headline === null ? "" : `<p class=headline>${escape(s.headline[0])}<br>${escape(s.headline[1])}</p>`) +
          `<ol class=beats>${s.beats.map((b) =>
            b._tag === "Narration"
              ? `<li class=narration>${escape(b.text)}</li>`
              : b._tag === "Cta"
              ? `<li class=narration>${escape(closingLine(b.question))}</li>`
              : `<li class=real><q>${escape(b.quote)}</q> <span class=muted>${clock(b.start)}</span></li>`
          ).join("")}</ol>`
      })
    case "metadata":
      return Option.match(as(ShortMetadata), {
        onNone: json,
        onSome: (m) =>
          `<p class=headline>${escape(m.title)}</p><ul>${m.alternates.map((a) => `<li>${escape(a)}</li>`).join("")}</ul>` +
          `<p>${escape(m.description)}</p><p class=muted>${m.hashtags.map(escape).join(" ")}</p>`
      })
    case "set-story":
      return Option.match(as(SetStory), { onNone: json, onSome: (s) => renderSetStory(s, videos) })
  }
}

const renderRun = (r: EvalRunResult, videos: Videos, label?: string): string => {
  const status = r.status === "passed"
    ? r.firstTryPass === true ? "passed first try" : `passed after ${r.fixRounds} fix round${r.fixRounds === 1 ? "" : "s"}`
    : r.status
  const facts = r.status === "skipped" ? "" : ` · ${costText(r.costUsd, r.inputTokens + r.outputTokens, r.billing === "subscription", r.costBasis)} · ${r.seconds.toFixed(1)}s${r.reportedModel === null ? "" : ` · ${escape(r.reportedModel)}`}`
  const problems = r.firstTryProblems.length === 0 || r.firstTryPass === true
    ? ""
    : `<details><summary>first try: ${r.firstTryProblems.length} problem(s)</summary><ul>${r.firstTryProblems.map((p) => `<li>${escape(named(videos, p))}</li>`).join("")}</ul></details>`
  const body = r.status === "passed" ? renderOutput(r.stage, r.result, videos) : `<p class=error>${escape(r.error ?? "")}</p>`
  const name = label === undefined ? "" : `${escape(label)} · `
  return `<div class="run ${r.status}"><div class=facts><b>${name}Run ${r.run}</b> · ${status}${facts}</div>${problems}${body}</div>`
}

// The side-by-side page: per stage, one column per model (and the approved output where the fixture has one),
// each holding its runs, for judging by eye.
export const reportHtml = (report: EvalReport): string => {
  const rows = summarize(report)
  const summary = `<table><thead><tr><th>stage</th><th>model</th><th>passed</th><th>first try</th><th>fix rounds</th><th>avg cost</th><th>avg time</th><th>skipped</th></tr></thead><tbody>${
    rows.map((r) =>
      `<tr><td>${r.stage}</td><td>${escape(r.model)}</td><td>${r.passed}/${r.runs}</td><td>${r.firstTryPassed}/${r.runs}</td><td>${r.fixRounds}</td><td>${costText(r.avgCostUsd, r.avgTokens, r.onPlan, r.costBasis)}</td><td>${r.avgSeconds.toFixed(1)}s</td><td>${r.skipped}</td></tr>`
    ).join("")
  }</tbody></table>`
  const videos = report.videos ?? []
  const sections = report.stages.map((stage) => {
    const reference = report.reference[stage]
    // a set story is wide (three proposals side by side), so each run gets its own row instead of a column
    if (stage === "set-story") {
      const legend = videos.length === 0 ? "" : `<p class=legend>${videos.map((_, i) => videoChip(videos, i)).join("")}</p>`
      const rows = [
        ...(reference === undefined || reference === null ? [] : [`<div class="run reference"><div class=facts><b>Approved</b></div>${renderOutput(stage, reference, videos)}</div>`]),
        ...report.models.flatMap((model) => report.results.filter((r) => r.stage === stage && r.model === model).map((r) => renderRun(r, videos, model)))
      ]
      return `<section><h2>${stage}</h2>${legend}${rows.join("")}</section>`
    }
    const columns = [
      ...(reference === undefined ? [] : [`<div class="col reference"><h3>Approved</h3><div class=run>${renderOutput(stage, reference, videos)}</div></div>`]),
      ...report.models.map((model) =>
        `<div class=col><h3>${escape(model)}</h3>${report.results.filter((r) => r.stage === stage && r.model === model).map((r) => renderRun(r, videos)).join("")}</div>`
      )
    ]
    return `<section><h2>${stage}</h2><div class=cols style="--n:${columns.length}">${columns.join("")}</div></section>`
  })
  return `<!doctype html>
<html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Viral eval</title>
<style>
:root{--bg:#fafaf9;--card:#fff;--fg:#1c1917;--muted:#78716c;--line:#e7e5e4;--ok:#15803d;--bad:#b91c1c;--accent:#fef9c3}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--card:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--line:#292524;--ok:#4ade80;--bad:#f87171;--accent:#3f3a12}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:17px;text-transform:capitalize;margin:32px 0 12px}h3{font-size:13px;margin:0 0 8px;word-break:break-all}h4{margin:12px 0 4px}
.muted{color:var(--muted)}table{border-collapse:collapse;width:100%;max-width:1000px;overflow-x:auto;display:block}
th,td{text-align:left;padding:4px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
.cols{display:grid;grid-template-columns:repeat(var(--n),minmax(280px,1fr));gap:12px;overflow-x:auto}
.col{min-width:0}.reference .run{background:var(--accent)}
.run{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-bottom:10px}
.run.failed .facts{color:var(--bad)}.run.passed .facts{color:var(--ok)}.run.skipped{opacity:.6}
.facts{font-size:12px;margin-bottom:6px}.error{color:var(--bad);white-space:pre-wrap}
.headline{font-weight:700;font-size:16px}.tag{font-size:11px;border:1px solid var(--line);border-radius:4px;padding:0 4px}
ol,ul{padding-left:20px;margin:6px 0}li{margin:4px 0}.real q{font-style:italic}.narration{}
pre{white-space:pre-wrap;font-size:12px}details{margin:6px 0}summary{cursor:pointer;color:var(--muted)}
.run.reference{background:var(--accent)}
.video{display:inline-flex;align-items:center;gap:5px;margin-right:10px;white-space:nowrap;font-size:12px}
.video i{width:9px;height:9px;border-radius:50%;display:inline-block}
.parts{list-style:none;padding:0}.legend{margin:0 0 10px}
.proposals{display:grid;grid-template-columns:repeat(3,minmax(220px,1fr));gap:10px;margin:10px 0;overflow-x:auto}
.proposal{border:1px solid var(--line);border-radius:8px;padding:8px 10px;min-width:0}.proposal p{margin:6px 0}
.uses{margin:6px 0}.scores{font-size:12px;color:var(--muted)}
</style></head><body>
<h1>Viral eval · ${escape(report.fixture)}</h1>
<p class=muted>${escape(report.createdAt)} · ${report.runs} run(s) each · budget $${report.budgetUsd.toFixed(2)} for priced runs · spent ${usd(report.spentUsd)}</p>
${summary}
${sections.join("\n")}
</body></html>
`
}
