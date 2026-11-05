import { NodeServices } from "@effect/platform-node"
import {
  type Artifact,
  ArtifactId,
  type ArtifactOwner,
  ProjectArtifactKind,
  ProjectId,
  SourceArtifactKind,
  SourceId
} from "@viral/contracts"
import { Context, DateTime, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SqlClient, SqlSchema } from "effect/sql"
import { ViralHome } from "../home/viral-home.ts"
import { DatabaseLive } from "../persistence/database.ts"

type Kind = Artifact["kind"]

// Where a new artifact version's files go, before it is recorded.
export interface ArtifactSlot {
  readonly owner: ArtifactOwner
  readonly kind: Kind
  readonly version: number
  // absolute folder for this version's files: <owner folder>/<kind>/v<version>/
  readonly dir: string
  // the same folder relative to the owner's folder, for `path`
  readonly relDir: string
}

const DataJson = Schema.fromJsonString(Schema.Unknown)

const ArtifactRow = Schema.Struct({
  id: ArtifactId,
  source_id: Schema.NullOr(SourceId),
  project_id: Schema.NullOr(ProjectId),
  kind: Schema.Union([SourceArtifactKind, ProjectArtifactKind]),
  version: Schema.Int,
  data: Schema.NullOr(DataJson),
  path: Schema.NullOr(Schema.String),
  created_at: Schema.DateTimeUtcFromString
})
const toArtifact = (row: typeof ArtifactRow.Type): Artifact => ({
  id: row.id,
  owner: row.source_id !== null ? { _tag: "Source", id: row.source_id } : { _tag: "Project", id: row.project_id! },
  kind: row.kind,
  version: row.version,
  data: row.data,
  path: row.path,
  createdAt: row.created_at
})

// Stage outputs, versioned and never overwritten: regenerating adds version N+1 in its own folder, and
// the current artifact of a kind is the highest version. Owned by a source (video-level work) or a
// project (one short).
export class Artifacts extends Context.Service<Artifacts, {
  // Reserves the next version and creates its folder.
  allocate(owner: ArtifactOwner, kind: Kind): Effect.Effect<ArtifactSlot>
  record(slot: ArtifactSlot, output: { readonly data: unknown; readonly path: string | null }): Effect.Effect<Artifact>
  latest(owner: ArtifactOwner, kind: Kind): Effect.Effect<Option.Option<Artifact>>
  list(owner: ArtifactOwner): Effect.Effect<ReadonlyArray<Artifact>>
  // Absolute path of an artifact's file.
  resolve(artifact: Artifact): string | null
}>()("@viral/server/artifacts/artifacts") {
  static readonly layer = Layer.effect(
    Artifacts,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const random = yield* SecureRandom.SecureRandom
      const home = yield* ViralHome

      const ownerDir = (owner: ArtifactOwner) =>
        owner._tag === "Source" ? home.sourceDir(owner.id) : home.projectDir(owner.id)
      const ownerColumn = (owner: ArtifactOwner) => owner._tag === "Source" ? "source_id" : "project_id"

      const findLatest = SqlSchema.findOneOption({
        Request: Schema.Struct({ column: Schema.String, id: Schema.String, kind: Schema.String }),
        Result: ArtifactRow,
        execute: ({ column, id, kind }) =>
          sql`SELECT * FROM artifacts WHERE ${sql(column)} = ${id} AND kind = ${kind} ORDER BY version DESC LIMIT 1`
      })
      const findAll = SqlSchema.findAll({
        Request: Schema.Struct({ column: Schema.String, id: Schema.String }),
        Result: ArtifactRow,
        execute: ({ column, id }) =>
          sql`SELECT * FROM artifacts WHERE ${sql(column)} = ${id} ORDER BY kind, version DESC`
      })

      const latest = Effect.fn("Artifacts.latest")(function*(owner: ArtifactOwner, kind: Kind) {
        const row = yield* findLatest({ column: ownerColumn(owner), id: owner.id, kind }).pipe(Effect.orDie)
        return Option.map(row, toArtifact)
      })

      const allocate = Effect.fn("Artifacts.allocate")(function*(owner: ArtifactOwner, kind: Kind) {
        const current = yield* latest(owner, kind)
        const version = Option.match(current, { onNone: () => 1, onSome: (a) => a.version + 1 })
        const relDir = path.join(kind, `v${version}`)
        const dir = path.join(ownerDir(owner), relDir)
        yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.orDie)
        return { owner, kind, version, dir, relDir }
      })

      const record = Effect.fn("Artifacts.record")(
        function*(slot: ArtifactSlot, output: { readonly data: unknown; readonly path: string | null }) {
          const id = ArtifactId.make(yield* random.uuidV7())
          const now = DateTime.formatIso(yield* DateTime.now)
          const data = output.data === undefined || output.data === null
            ? null
            : yield* Schema.encodeEffect(DataJson)(output.data)
          const sourceId = slot.owner._tag === "Source" ? slot.owner.id : null
          const projectId = slot.owner._tag === "Project" ? slot.owner.id : null
          yield* sql`
            INSERT INTO artifacts (id, source_id, project_id, kind, version, data, path, created_at)
            VALUES (${id}, ${sourceId}, ${projectId}, ${slot.kind}, ${slot.version}, ${data}, ${output.path}, ${now})
          `
          const row = yield* findLatest({ column: ownerColumn(slot.owner), id: slot.owner.id, kind: slot.kind })
          return toArtifact(Option.getOrThrow(row))
        },
        Effect.orDie
      )

      const list = Effect.fn("Artifacts.list")(function*(owner: ArtifactOwner) {
        const rows = yield* findAll({ column: ownerColumn(owner), id: owner.id }).pipe(Effect.orDie)
        return rows.map(toArtifact)
      })

      const resolve = (artifact: Artifact) =>
        artifact.path === null ? null : path.join(ownerDir(artifact.owner), artifact.path)

      return Artifacts.of({ allocate, record, latest, list, resolve })
    })
  ).pipe(Layer.provide([DatabaseLive, ViralHome.layer, NodeServices.layer, SecureRandom.layerWebCrypto]))
}
