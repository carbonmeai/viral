import assert from "node:assert/strict"
import { test } from "node:test"
import { combineReports, type EvalReport, reportHtml, reportMarkdown, summarize } from "./eval-report.ts"
import type { EvalRunResult } from "./eval-runner.ts"

const run = (overrides: Partial<EvalRunResult>): EvalRunResult => ({
  stage: "metadata",
  model: "openai/gpt-6-luna",
  provider: "ai-gateway",
  run: 1,
  status: "passed",
  error: null,
  costUsd: 0.01,
  inputTokens: 100,
  outputTokens: 20,
  seconds: 2,
  reportedModel: "openai/gpt-6-luna",
  firstTryPass: true,
  firstTryProblems: [],
  fixRounds: 0,
  result: { title: "Candy <that> lies", alternates: ["A"], description: "D.", hashtags: ["#shorts"] },
  ...overrides
})

const report: EvalReport = {
  createdAt: "2026-11-06T12:00:00Z",
  fixture: "candy",
  stages: ["metadata"],
  models: ["openai/gpt-6-luna"],
  runs: 3,
  budgetUsd: 5,
  spentUsd: 0.04,
  reference: {},
  results: [
    run({}),
    run({ run: 2, costUsd: 0.03, seconds: 4, firstTryPass: false, firstTryProblems: ["title too long"], fixRounds: 1 }),
    run({ run: 3, status: "skipped", costUsd: 0, seconds: 0, firstTryPass: null, result: null, error: "budget" })
  ]
}

test("summarize averages the runs that ran and leaves the skipped ones out", () => {
  assert.deepEqual(summarize(report), [{
    stage: "metadata",
    model: "openai/gpt-6-luna",
    runs: 2,
    passed: 2,
    skipped: 1,
    firstTryPassed: 1,
    fixRounds: 1,
    avgCostUsd: 0.02,
    avgSeconds: 3
  }])
  assert.match(reportMarkdown(report), /\| metadata \| openai\/gpt-6-luna \| 2\/2 \| 1\/2 \| 1 \|/)
})

test("the page shows each output readably and escapes it", () => {
  const html = reportHtml(report)
  assert.match(html, /Candy &lt;that&gt; lies/)
  assert.doesNotMatch(html, /Candy <that>/)
  assert.match(html, /passed after 1 fix round ·/)
  assert.match(html, /title too long/)
})

test("combining reports numbers the runs on from the earlier ones and adds up the spend", () => {
  const later: EvalReport = {
    ...report,
    createdAt: "2026-11-07T12:00:00Z",
    stages: ["metadata", "ads"],
    models: ["openai/gpt-6-luna", "claude-cli"],
    runs: 1,
    spentUsd: 0.02,
    results: [run({}), run({ stage: "ads", model: "claude-cli", provider: "claude-cli" })]
  }
  const combined = combineReports(later, [report])
  assert.deepEqual(combined.results.map((r) => `${r.stage} ${r.model} ${r.run}`), [
    "metadata openai/gpt-6-luna 1",
    "metadata openai/gpt-6-luna 2",
    "metadata openai/gpt-6-luna 3",
    "metadata openai/gpt-6-luna 4",
    "ads claude-cli 1"
  ])
  assert.deepEqual(combined.stages, ["metadata", "ads"])
  assert.deepEqual(combined.models, ["openai/gpt-6-luna", "claude-cli"])
  assert.equal(combined.runs, 4)
  assert.equal(combined.spentUsd, 0.06)
  assert.equal(combined.createdAt, "2026-11-07T12:00:00Z")
  assert.equal(combineReports(later, []), later)
})
