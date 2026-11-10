import { DateTime, Effect, Layer } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { VoicePreviews } from "../voice/voice-previews.ts"
import { UsageReport } from "./usage.ts"
import { UsageRecords } from "./usage-records.ts"
import { SqlClient } from "effect/sql"
import { DatabaseLive } from "../persistence/database.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-usage-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

test("a recorded \"Try a line\" preview shows in Usage as ElevenLabs characters outside any short", async () => {
  const usage = await Effect.runPromise(Effect.gen(function*() {
    const previews = yield* VoicePreviews
    yield* previews.record("voice-1", "eleven_v4", 74)
    yield* previews.record("voice-2", "eleven_v4", 12)
    return yield* (yield* UsageReport).get(7)
  }).pipe(Effect.provide(Layer.mergeAll(VoicePreviews.layer, UsageReport.layer))))
  assert.equal(usage.elevenLabs.characters, 86)
  assert.deepEqual([usage.elevenLabs.previews, usage.elevenLabs.previewCharacters, usage.elevenLabs.takes], [2, 86, 0])
  assert.deepEqual(usage.elevenLabs.byModel, [{ model: "eleven_v4", characters: 86, takes: 0, previews: 2 }])
  assert.deepEqual(usage.elevenLabs.byShort, [])
  assert.equal(usage.elevenLabs.byDay.at(-1)?.characters, 86)
})

test("the chat's intent agent counts in Usage under its short, step \"chat\", on its provider's billing", async () => {
  const usage = await Effect.runPromise(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const now = DateTime.formatIso(yield* DateTime.now)
    yield* sql`INSERT INTO projects (id, number, slug, title, approach, format, created_at, updated_at)
      VALUES ('usage-short', 1, '01-usage', 'Candy', 'cut-down', 'cut-down', ${now}, ${now})`
    const records = yield* UsageRecords
    yield* records.record({ projectId: "usage-short", step: "chat", provider: "claude-cli", model: "claude-haiku-4-5", billing: "subscription", inputTokens: 900, outputTokens: 40, costUsd: 0.012 })
    yield* records.record({ projectId: "usage-short", step: "chat", provider: "anthropic", model: "claude-haiku-5-5", billing: "billed", inputTokens: 800, outputTokens: 30, costUsd: 0.0001, costBasis: "estimate" })
    return yield* (yield* UsageReport).get(7)
  }).pipe(Effect.provide(Layer.mergeAll(UsageRecords.layer, UsageReport.layer, DatabaseLive))))
  assert.deepEqual(usage.byStage.find((s) => s.stage === "chat"), { stage: "chat", model: "claude-haiku-4-5", runs: 2, costUsd: 0.0121, ttsCharacters: 0 })
  assert.deepEqual(usage.byShort.find((s) => s.projectId === "usage-short"), { projectId: "usage-short", title: "Candy", costUsd: 0.0121, ttsCharacters: 0 })
  assert.deepEqual([usage.billing.subscriptionUsd, usage.billing.billedUsd], [0.012, 0.0001])
  assert.equal(usage.totals.estimatedUsd, 0.0001)
})
