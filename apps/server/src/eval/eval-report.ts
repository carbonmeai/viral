import { AdRanges, Script, ShortMetadata, StoryMap } from "@viral/contracts"
import { Option, Schema } from "effect"
import type { EvalRunResult } from "./eval-runner.ts"
import type { EvalStageName } from "./eval-stages.ts"

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
  // the fixture's approved output per stage (the short's script, the source's story and ads)
  readonly reference: Partial<Record<EvalStageName, unknown>>
}

// A report.json as read back (for --include and `eval record`): the fields the summary and recording use.
export const StoredEvalReport = Schema.fromJsonString(Schema.Struct({
  createdAt: Schema.String,
  fixture: Schema.String,
  stages: Schema.Array(Schema.Literals(["ads", "story", "script", "metadata"])),
  models: Schema.Array(Schema.String),
  runs: Schema.Int,
  budgetUsd: Schema.Number,
  spentUsd: Schema.Number,
  results: Schema.Array(Schema.Struct({
    stage: Schema.Literals(["ads", "story", "script", "metadata"]),
    model: Schema.String,
    provider: Schema.Literals(["claude-cli", "ai-gateway"]),
    run: Schema.Int,
    status: Schema.Literals(["passed", "failed", "skipped"]),
    error: Schema.NullOr(Schema.String),
    costUsd: Schema.Number,
    inputTokens: Schema.Number,
    outputTokens: Schema.Number,
    seconds: Schema.Number,
    reportedModel: Schema.NullOr(Schema.String),
    firstTryPass: Schema.NullOr(Schema.Boolean),
    firstTryProblems: Schema.Array(Schema.String),
    fixRounds: Schema.Int,
    result: Schema.Unknown
  })),
  reference: Schema.Record(Schema.String, Schema.Unknown)
}))

// Adds earlier reports' runs to this one, numbering them first, so one page and one table compare every run.
export const combineReports = (report: EvalReport, earlier: ReadonlyArray<EvalReport>): EvalReport => {
  if (earlier.length === 0) return report
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
    results
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
  readonly avgSeconds: number
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
        avgSeconds: avg((r) => r.seconds)
      }
    })
  )

const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 3)}`

export const reportMarkdown = (report: EvalReport): string =>
  [
    `# Eval ${report.createdAt}`,
    "",
    `Fixture **${report.fixture}**, ${report.runs} run(s) each, budget $${report.budgetUsd.toFixed(2)}, spent **${usd(report.spentUsd)}**.`,
    "",
    "| stage | model | passed | first try | fix rounds | avg cost | avg time | skipped |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...summarize(report).map((r) =>
      `| ${r.stage} | ${r.model} | ${r.passed}/${r.runs} | ${r.firstTryPassed}/${r.runs} | ${r.fixRounds} | ${usd(r.avgCostUsd)} | ${r.avgSeconds.toFixed(1)}s | ${r.skipped} |`
    ),
    ""
  ].join("\n")

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`

// A stage's output as you'd read it: the parts to judge, not the JSON.
const renderOutput = (stage: EvalStageName, value: unknown): string => {
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
  }
}

const renderRun = (r: EvalRunResult): string => {
  const status = r.status === "passed"
    ? r.firstTryPass === true ? "passed first try" : `passed after ${r.fixRounds} fix round${r.fixRounds === 1 ? "" : "s"}`
    : r.status
  const facts = r.status === "skipped" ? "" : ` · ${usd(r.costUsd)} · ${r.seconds.toFixed(1)}s${r.reportedModel === null ? "" : ` · ${escape(r.reportedModel)}`}`
  const problems = r.firstTryProblems.length === 0 || r.firstTryPass === true
    ? ""
    : `<details><summary>first try: ${r.firstTryProblems.length} problem(s)</summary><ul>${r.firstTryProblems.map((p) => `<li>${escape(p)}</li>`).join("")}</ul></details>`
  const body = r.status === "passed" ? renderOutput(r.stage, r.result) : `<p class=error>${escape(r.error ?? "")}</p>`
  return `<div class="run ${r.status}"><div class=facts><b>Run ${r.run}</b> · ${status}${facts}</div>${problems}${body}</div>`
}

// The side-by-side page: per stage, one column per model (and the approved output where the fixture has one),
// each holding its runs, for judging by eye.
export const reportHtml = (report: EvalReport): string => {
  const rows = summarize(report)
  const summary = `<table><thead><tr><th>stage</th><th>model</th><th>passed</th><th>first try</th><th>fix rounds</th><th>avg cost</th><th>avg time</th><th>skipped</th></tr></thead><tbody>${
    rows.map((r) =>
      `<tr><td>${r.stage}</td><td>${escape(r.model)}</td><td>${r.passed}/${r.runs}</td><td>${r.firstTryPassed}/${r.runs}</td><td>${r.fixRounds}</td><td>${usd(r.avgCostUsd)}</td><td>${r.avgSeconds.toFixed(1)}s</td><td>${r.skipped}</td></tr>`
    ).join("")
  }</tbody></table>`
  const sections = report.stages.map((stage) => {
    const reference = report.reference[stage]
    const columns = [
      ...(reference === undefined ? [] : [`<div class="col reference"><h3>Approved</h3><div class=run>${renderOutput(stage, reference)}</div></div>`]),
      ...report.models.map((model) =>
        `<div class=col><h3>${escape(model)}</h3>${report.results.filter((r) => r.stage === stage && r.model === model).map(renderRun).join("")}</div>`
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
</style></head><body>
<h1>Viral eval · ${escape(report.fixture)}</h1>
<p class=muted>${escape(report.createdAt)} · ${report.runs} run(s) each · budget $${report.budgetUsd.toFixed(2)} · spent ${usd(report.spentUsd)}</p>
${summary}
${sections.join("\n")}
</body></html>
`
}
