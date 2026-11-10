import {
  type ChatEntry,
  ChatItem,
  ChatItemId,
  ChatRole,
  ProjectId,
  RequestId,
  RunId,
  StageName,
  StageRunId
} from "@viral/contracts"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SqlClient, SqlSchema } from "effect/sql"
import { DatabaseLive } from "../persistence/database.ts"

const ItemJson = Schema.fromJsonString(ChatItem)

const ChatRow = Schema.Struct({
  id: ChatItemId,
  seq: Schema.Int,
  role: ChatRole,
  stage: Schema.NullOr(StageName),
  run_id: Schema.NullOr(RunId),
  stage_run_id: Schema.NullOr(StageRunId),
  request_id: Schema.NullOr(RequestId),
  body: ItemJson,
  created_at: Schema.DateTimeUtcFromString
})
const toEntry = (row: typeof ChatRow.Type): ChatEntry => ({
  id: row.id,
  seq: row.seq,
  role: row.role,
  stage: row.stage,
  runId: row.run_id,
  stageRunId: row.stage_run_id,
  requestId: row.request_id,
  item: row.body,
  createdAt: row.created_at
})

// What an item points at, besides its owner.
export interface ChatRefs {
  readonly stage?: StageName | null
  readonly runId?: RunId | null
  readonly stageRunId?: StageRunId | null
  readonly requestId?: RequestId | null
}

// The chat_items table (migration 0008): a short's conversation in the order it was written. `seq` is given in the
// insert itself (one more than the short's last), so items are ordered even when written from two places.
export class ChatStore extends Context.Service<ChatStore, {
  append(projectId: ProjectId, role: ChatEntry["role"], item: ChatItem, refs?: ChatRefs): Effect.Effect<ChatEntry>
  list(projectId: ProjectId, afterSeq?: number): Effect.Effect<ReadonlyArray<ChatEntry>>
  lastSeq(projectId: ProjectId): Effect.Effect<number>
  // whether an item of this kind was already written for that stage run or request (items from run events are
  // written once, whether live or rebuilt from an older short's runs)
  has(projectId: ProjectId, kind: ChatItem["_tag"], ref: { readonly stageRunId?: StageRunId; readonly requestId?: RequestId }): Effect.Effect<boolean>
}>()("@viral/server/chat/chat-store/ChatStore") {
  static readonly layer = Layer.effect(
    ChatStore,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const random = yield* SecureRandom.SecureRandom

      const byId = SqlSchema.findOne({ Request: ChatItemId, Result: ChatRow, execute: (id) => sql`SELECT * FROM chat_items WHERE id = ${id}` })

      const append = Effect.fn("ChatStore.append")(function*(projectId: ProjectId, role: ChatEntry["role"], item: ChatItem, refs: ChatRefs = {}) {
        const id = ChatItemId.make(yield* random.uuidV7())
        const body = yield* Schema.encodeEffect(ItemJson)(item)
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql`
          INSERT INTO chat_items (id, project_id, seq, role, kind, stage, run_id, stage_run_id, request_id, body, created_at)
          VALUES (${id}, ${projectId}, (SELECT coalesce(max(seq), 0) + 1 FROM chat_items WHERE project_id = ${projectId}),
            ${role}, ${item._tag}, ${refs.stage ?? null}, ${refs.runId ?? null}, ${refs.stageRunId ?? null}, ${refs.requestId ?? null},
            ${body}, ${now})
        `
        return toEntry(yield* byId(id))
      }, Effect.orDie)

      const list = (projectId: ProjectId, afterSeq = 0) =>
        SqlSchema.findAll({
          Request: Schema.Struct({ projectId: ProjectId, afterSeq: Schema.Int }),
          Result: ChatRow,
          execute: (req) => sql`SELECT * FROM chat_items WHERE project_id = ${req.projectId} AND seq > ${req.afterSeq} ORDER BY seq`
        })({ projectId, afterSeq }).pipe(Effect.map((rows) => rows.map(toEntry)), Effect.orDie)

      const lastSeq = (projectId: ProjectId) =>
        sql<{ readonly seq: number }>`SELECT coalesce(max(seq), 0) AS seq FROM chat_items WHERE project_id = ${projectId}`.pipe(
          Effect.map((rows) => rows[0]?.seq ?? 0),
          Effect.orDie
        )

      const has = (projectId: ProjectId, kind: ChatItem["_tag"], ref: { readonly stageRunId?: StageRunId; readonly requestId?: RequestId }) =>
        (ref.requestId !== undefined
          ? sql<{ readonly n: number }>`SELECT count(*) AS n FROM chat_items WHERE project_id = ${projectId} AND kind = ${kind} AND request_id = ${ref.requestId}`
          : sql<{ readonly n: number }>`SELECT count(*) AS n FROM chat_items WHERE project_id = ${projectId} AND kind = ${kind} AND stage_run_id = ${ref.stageRunId ?? null}`
        ).pipe(Effect.map((rows) => (rows[0]?.n ?? 0) > 0), Effect.orDie)

      return ChatStore.of({ append, list, lastSeq, has })
    })
  ).pipe(Layer.provide([DatabaseLive, SecureRandom.layerWebCrypto]))
}
