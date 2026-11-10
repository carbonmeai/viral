import { Context, DateTime, Effect, Layer } from "effect"
import { SecureRandom } from "effect/crypto"
import { SqlClient } from "effect/sql"
import { DatabaseLive } from "../persistence/database.ts"

// The steps whose spend has no stage run: the chat's intent agent, the generators and the thumbnail's image model.
export type UsageStep = "chat" | "voice-design" | "sound-effect" | "thumbnail"

// One bill outside a run: an agent call's tokens and dollars, or ElevenLabs' characters (credits).
export interface UsageRecord {
  readonly projectId: string | null
  readonly step: UsageStep
  readonly provider: string
  readonly model: string | null
  readonly billing: "billed" | "subscription" | null
  readonly inputTokens?: number | null
  readonly outputTokens?: number | null
  // null = no known price (the tokens still count)
  readonly costUsd?: number | null
  readonly costBasis?: "reported" | "estimate" | "unknown" | null
  readonly characters?: number | null
}

// Spend outside a run (usage_records, 0009), written the moment it's billed so Settings › Usage counts it whatever
// happens after.
export class UsageRecords extends Context.Service<UsageRecords, {
  record(entry: UsageRecord): Effect.Effect<void>
}>()("@viral/server/usage/usage-records/UsageRecords") {
  static readonly layer = Layer.effect(
    UsageRecords,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const random = yield* SecureRandom.SecureRandom
      const record = Effect.fn("UsageRecords.record")(function*(entry: UsageRecord) {
        const id = yield* random.uuidV7()
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql`
          INSERT INTO usage_records (id, project_id, step, provider, model, billing, input_tokens, output_tokens, cost_usd, cost_basis, characters, created_at)
          VALUES (${id}, ${entry.projectId}, ${entry.step}, ${entry.provider}, ${entry.model}, ${entry.billing},
                  ${entry.inputTokens ?? null}, ${entry.outputTokens ?? null}, ${entry.costUsd ?? null}, ${entry.costBasis ?? null},
                  ${entry.characters ?? null}, ${now})
        `.pipe(Effect.orDie)
      })
      return UsageRecords.of({ record })
    })
  ).pipe(Layer.provide([DatabaseLive, SecureRandom.layerWebCrypto]))
}
