import { NodeServices } from "@effect/platform-node"
import {
  APPROACHES,
  ApproachName,
  type ArtifactKind,
  CutPlan,
  MAX_SHORT_SOURCES,
  MusicTrackId,
  type MusicTrackNotFound,
  PresetId,
  type PresetNotFound,
  type Project,
  ProjectFormat,
  ProjectId,
  ProjectNotFound,
  ProjectSourceInUse,
  ProjectSourcesInvalid,
  ProposalNotFound,
  SetProposalNotFound,
  Script,
  SetStory,
  ShotPlan,
  SourceId,
  type SourceNotFound,
  SourceSetId,
  StoryMap,
  Thumbnail,
  type VideoSetNotFound
} from "@viral/contracts"
import { Context, DateTime, Effect, FileSystem, Layer, Option, Schema } from "effect"
import { SecureRandom } from "effect/crypto"
import { SqlClient, SqlSchema } from "effect/sql"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ViralHome } from "../home/viral-home.ts"
import { arrangementKey } from "../music-bed/music-bed-settings.ts"
import { MusicLibrary } from "../music-library/music-library.ts"
import { DatabaseLive } from "../persistence/database.ts"
import { Presets } from "../presets/presets.ts"
import { RunStore } from "../runs/run-store.ts"
import { Settings } from "../settings/settings.ts"
import { Sources } from "../sources/sources.ts"
import { VideoSets } from "../video-sets/video-sets.ts"
import { projectSlug } from "./project-slug.ts"
import { removalProblem } from "./video-uses.ts"

export interface CreateProjectInput {
  // the short's videos, V1 first
  readonly sourceIds: readonly [SourceId, ...Array<SourceId>]
  readonly title: string
  readonly approach: ApproachName
  readonly presetId: PresetId | null
  readonly musicTrackId: MusicTrackId | null
  // what the short should achieve, in your words; null or blank = none. Required for several videos.
  readonly brief?: string | null
  // the video set it came from, if any
  readonly setId?: SourceSetId | null
}

// The videos a short draws from, V1 first. A clip's `source` index points into this list.
export const sourcesOf = (project: Project): readonly [SourceId, ...Array<SourceId>] => project.sourceIds

// Why these videos don't make a short, or null when they do.
export const sourcesProblem = (sourceIds: ReadonlyArray<SourceId>, brief: string | null): string | null => {
  if (sourceIds.length === 0) return "a short needs a video"
  if (sourceIds.length > MAX_SHORT_SOURCES) return `a short can use up to ${MAX_SHORT_SOURCES} videos, not ${sourceIds.length}`
  if (new Set(sourceIds).size !== sourceIds.length) return "each video can be in a short once"
  if (sourceIds.length > 1 && brief === null) return "a short from several videos needs a brief: what should it achieve?"
  return null
}

// A brief is kept as written, minus surrounding space; a blank one is no brief.
export const cleanBrief = (brief: string | null | undefined) => {
  const trimmed = brief?.trim() ?? ""
  return trimmed === "" ? null : trimmed
}

const ProjectRow = Schema.Struct({
  id: ProjectId,
  // the short's videos in order, from project_sources (a JSON array)
  source_ids: Schema.fromJsonString(Schema.NonEmptyArray(SourceId)),
  set_id: Schema.NullOr(SourceSetId),
  number: Schema.Int,
  slug: Schema.String,
  title: Schema.String,
  approach: ApproachName,
  format: ProjectFormat,
  preset_id: Schema.NullOr(PresetId),
  music_track_id: Schema.NullOr(MusicTrackId),
  voice_id: Schema.NullOr(Schema.String),
  brief: Schema.NullOr(Schema.String),
  created_at: Schema.DateTimeUtcFromString,
  updated_at: Schema.DateTimeUtcFromString
})
const toProject = (row: typeof ProjectRow.Type): Project => ({
  id: row.id,
  sourceIds: row.source_ids,
  setId: row.set_id,
  number: row.number,
  slug: row.slug,
  title: row.title,
  approach: row.approach,
  format: row.format,
  presetId: row.preset_id,
  musicTrackId: row.music_track_id,
  voiceId: row.voice_id,
  brief: row.brief,
  createdAt: row.created_at,
  updatedAt: row.updated_at
})

// A short made from one or more videos (project_sources, V1 first): a row plus ~/.viral/projects/<id>/ for its
// own artifacts. Shorts are numbered across the library (07-…); the ones made before multi-video keep their
// per-video numbers.
export class Projects extends Context.Service<Projects, {
  create(input: CreateProjectInput): Effect.Effect<Project, SourceNotFound | PresetNotFound | MusicTrackNotFound | ProjectSourcesInvalid>
  // A short from the source story's proposal number `proposal` (0-based): its approach and title.
  fromProposal(sourceId: SourceId, proposal: number, brief?: string | null): Effect.Effect<Project, SourceNotFound | ProposalNotFound>
  // A short from a video set's proposal number `proposal` (0-based): its approach and title, the videos it uses in
  // set order, and the set's brief unless `brief` is given (editable later, like any short's).
  fromSetProposal(setId: SourceSetId, proposal: number, brief?: string | null): Effect.Effect<Project, VideoSetNotFound | SetProposalNotFound>
  setBrief(id: ProjectId, brief: string | null): Effect.Effect<Project, ProjectNotFound>
  setVoice(id: ProjectId, voiceId: string | null): Effect.Effect<Project, ProjectNotFound>
  setPreset(id: ProjectId, presetId: PresetId | null): Effect.Effect<Project, ProjectNotFound | PresetNotFound>
  setMusic(id: ProjectId, musicTrackId: MusicTrackId | null): Effect.Effect<Project, ProjectNotFound | MusicTrackNotFound>
  // a video added after the short's others (up to 10); nothing re-runs
  addSource(id: ProjectId, sourceId: SourceId): Effect.Effect<Project, ProjectNotFound | SourceNotFound | ProjectSourcesInvalid>
  // a video taken out, the ones after it moving up; refused while a step's current work uses it or a video after it,
  // while a run is working on the short, and for its only video
  removeSource(id: ProjectId, sourceId: SourceId): Effect.Effect<Project, ProjectNotFound | ProjectSourcesInvalid | ProjectSourceInUse>
  // every short, or the shorts that use one video
  list(sourceId: SourceId | null): Effect.Effect<ReadonlyArray<Project>>
  get(id: ProjectId): Effect.Effect<Project, ProjectNotFound>
  remove(id: ProjectId): Effect.Effect<boolean>
}>()("@viral/server/projects/projects") {
  static readonly layer = Layer.effect(
    Projects,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const fs = yield* FileSystem.FileSystem
      const random = yield* SecureRandom.SecureRandom
      const home = yield* ViralHome
      const sources = yield* Sources
      const presets = yield* Presets
      const music = yield* MusicLibrary
      const artifacts = yield* Artifacts
      const settings = yield* Settings
      const sets = yield* VideoSets
      const runs = yield* RunStore

      // a project with its videos in order, as one row
      const withSources = sql`
        SELECT p.*, (SELECT json_group_array(source_id) FROM (
          SELECT source_id FROM project_sources ps WHERE ps.project_id = p.id ORDER BY position
        )) AS source_ids
        FROM projects p`
      const findAll = SqlSchema.findAll({
        Request: Schema.Void,
        Result: ProjectRow,
        execute: () => sql`${withSources} ORDER BY p.updated_at DESC`
      })
      const findBySource = SqlSchema.findAll({
        Request: SourceId,
        Result: ProjectRow,
        execute: (sourceId) =>
          sql`${withSources} WHERE p.id IN (SELECT project_id FROM project_sources WHERE source_id = ${sourceId}) ORDER BY p.number`
      })
      const findById = SqlSchema.findOneOption({
        Request: ProjectId,
        Result: ProjectRow,
        execute: (id) => sql`${withSources} WHERE p.id = ${id}`
      })
      // numbered across the library, so a short from several videos has one number
      const nextNumber = SqlSchema.findOne({
        Request: Schema.Void,
        Result: Schema.Struct({ next: Schema.Int }),
        execute: () => sql`SELECT coalesce(max(number), 0) + 1 AS next FROM projects`
      })

      const get = Effect.fn("Projects.get")(function*(id: ProjectId) {
        const row = yield* findById(id).pipe(Effect.orDie)
        if (row._tag === "None") return yield* new ProjectNotFound({ id })
        return toProject(row.value)
      })

      const create = Effect.fn("Projects.create")(function*(input: CreateProjectInput) {
        const brief = cleanBrief(input.brief)
        const problem = sourcesProblem(input.sourceIds, brief)
        if (problem !== null) return yield* new ProjectSourcesInvalid({ message: problem })
        // Check references up front so callers get a typed error instead of a foreign-key failure.
        yield* Effect.forEach(input.sourceIds, (id) => sources.get(id), { discard: true })
        if (input.presetId !== null) yield* presets.get(input.presetId)
        if (input.musicTrackId !== null) yield* music.get(input.musicTrackId)

        const id = ProjectId.make(yield* random.uuidV7())
        const now = DateTime.formatIso(yield* DateTime.now)
        // Numbering and insert share a transaction so two shorts can't take the same number.
        yield* sql.withTransaction(Effect.gen(function*() {
          const { next } = yield* nextNumber()
          yield* sql`
            INSERT INTO projects (id, number, slug, title, approach, format, preset_id, music_track_id, brief, set_id,
                                  created_at, updated_at)
            VALUES (${id}, ${next}, ${projectSlug(next, input.title)}, ${input.title}, ${input.approach},
                    ${APPROACHES[input.approach].format}, ${input.presetId}, ${input.musicTrackId}, ${brief},
                    ${input.setId ?? null}, ${now}, ${now})
          `
          yield* Effect.forEach(input.sourceIds, (sourceId, position) =>
            sql`INSERT INTO project_sources (project_id, source_id, position) VALUES (${id}, ${sourceId}, ${position})`)
        })).pipe(Effect.orDie)
        yield* fs.makeDirectory(home.projectDir(id), { recursive: true }).pipe(Effect.orDie)
        return yield* get(id).pipe(Effect.orDie)
      })

      const fromProposal = Effect.fn("Projects.fromProposal")(function*(sourceId: SourceId, proposal: number, brief?: string | null) {
        yield* sources.get(sourceId)
        const story = yield* artifacts.latest({ _tag: "Source", id: sourceId }, "story-map")
        const chosen = Option.flatMap(story, (a) => Schema.decodeUnknownOption(StoryMap)(a.data)).pipe(
          Option.flatMapNullishOr((map) => map.proposals[proposal])
        )
        if (Option.isNone(chosen)) return yield* new ProposalNotFound({ sourceId, proposal })
        return yield* create({
          sourceIds: [sourceId],
          title: chosen.value.title,
          approach: chosen.value.approach,
          presetId: null,
          musicTrackId: null,
          brief: brief ?? null
        }).pipe(Effect.catchTag(["PresetNotFound", "MusicTrackNotFound", "ProjectSourcesInvalid"], Effect.die))
      })

      const fromSetProposal = Effect.fn("Projects.fromSetProposal")(function*(setId: SourceSetId, proposal: number, brief?: string | null) {
        const set = yield* sets.get(setId)
        const story = yield* artifacts.latest({ _tag: "Set", id: setId }, "set-story")
        const chosen = Option.flatMap(story, (a) => Schema.decodeUnknownOption(SetStory)(a.data)).pipe(
          Option.flatMapNullishOr((s) => s.proposals[proposal])
        )
        if (Option.isNone(chosen)) return yield* new SetProposalNotFound({ setId, proposal })
        // the proposal's videos in set order; one it names that the set no longer has is left out
        const used = [...new Set(chosen.value.sources)].sort((a, b) => a - b).flatMap((i) => set.sourceIds[i] ?? [])
        const [first, ...rest] = used.length > 0 ? used : set.sourceIds
        if (first === undefined) return yield* new SetProposalNotFound({ setId, proposal })
        return yield* create({
          sourceIds: [first, ...rest],
          title: chosen.value.title,
          approach: chosen.value.approach,
          presetId: null,
          musicTrackId: null,
          brief: cleanBrief(brief) ?? set.brief,
          setId
        }).pipe(Effect.catchTag(["SourceNotFound", "PresetNotFound", "MusicTrackNotFound", "ProjectSourcesInvalid"], Effect.die))
      })

      const list = Effect.fn("Projects.list")(function*(sourceId: SourceId | null) {
        const rows = yield* Option.match(Option.fromNullishOr(sourceId), {
          onNone: () => findAll(),
          onSome: findBySource
        }).pipe(Effect.orDie)
        return rows.map(toProject)
      })

      const setBrief = Effect.fn("Projects.setBrief")(function*(id: ProjectId, brief: string | null) {
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql`UPDATE projects SET brief = ${cleanBrief(brief)}, updated_at = ${now} WHERE id = ${id}`.pipe(Effect.orDie)
        return yield* get(id)
      })

      const setVoice = Effect.fn("Projects.setVoice")(function*(id: ProjectId, voiceId: string | null) {
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql`UPDATE projects SET voice_id = ${voiceId}, updated_at = ${now} WHERE id = ${id}`.pipe(Effect.orDie)
        return yield* get(id)
      })

      const setPreset = Effect.fn("Projects.setPreset")(function*(id: ProjectId, presetId: PresetId | null) {
        yield* get(id)
        if (presetId !== null) yield* presets.get(presetId)
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql`UPDATE projects SET preset_id = ${presetId}, updated_at = ${now} WHERE id = ${id}`.pipe(Effect.orDie)
        return yield* get(id)
      })

      const setMusic = Effect.fn("Projects.setMusic")(function*(id: ProjectId, musicTrackId: MusicTrackId | null) {
        const before = yield* get(id)
        if (musicTrackId !== null) yield* music.get(musicTrackId)
        // an arrangement is of one song: a different song starts from the automatic one again
        if (before.musicTrackId !== musicTrackId) yield* settings.remove(arrangementKey(id))
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql`UPDATE projects SET music_track_id = ${musicTrackId}, updated_at = ${now} WHERE id = ${id}`.pipe(Effect.orDie)
        return yield* get(id)
      })

      const addSource = Effect.fn("Projects.addSource")(function*(id: ProjectId, sourceId: SourceId) {
        const project = yield* get(id)
        yield* sources.get(sourceId)
        if (project.sourceIds.includes(sourceId)) return yield* new ProjectSourcesInvalid({ message: "that video is already in this short" })
        if (project.sourceIds.length >= MAX_SHORT_SOURCES) {
          return yield* new ProjectSourcesInvalid({ message: `a short can use up to ${MAX_SHORT_SOURCES} videos` })
        }
        const now = DateTime.formatIso(yield* DateTime.now)
        yield* sql.withTransaction(Effect.gen(function*() {
          yield* sql`INSERT INTO project_sources (project_id, source_id, position) VALUES (${id}, ${sourceId}, ${project.sourceIds.length})`
          yield* sql`UPDATE projects SET updated_at = ${now} WHERE id = ${id}`
        })).pipe(Effect.orDie)
        return yield* get(id)
      })

      // the latest version of each step's work that names videos
      const currentWork = Effect.fn("Projects.currentWork")(function*(id: ProjectId) {
        const owner = { _tag: "Project", id } as const
        const latest = <A, I>(kind: ArtifactKind, schema: Schema.Codec<A, I>) =>
          Effect.map(artifacts.latest(owner, kind), (a) => Option.getOrNull(Option.flatMap(a, (x) => Schema.decodeUnknownOption(schema)(x.data))))
        return {
          script: yield* latest("script", Script),
          shotPlan: yield* latest("shot-plan", ShotPlan),
          cutPlan: yield* latest("cut-plan", CutPlan),
          thumbnail: yield* latest("thumbnail", Thumbnail)
        }
      })

      const removeSource = Effect.fn("Projects.removeSource")(function*(id: ProjectId, sourceId: SourceId) {
        const project = yield* get(id)
        const index = project.sourceIds.indexOf(sourceId)
        if (index < 0) return yield* new ProjectSourcesInvalid({ message: "that video isn't in this short" })
        if (project.sourceIds.length === 1) return yield* new ProjectSourcesInvalid({ message: "a short needs a video; this is its only one" })
        const running = (yield* runs.listRuns({ _tag: "Project", id })).some((r) => r.status === "running")
        if (running) return yield* new ProjectSourceInUse({ message: "a run is working on this short; remove the video once it stops or waits for you" })
        const names = yield* Effect.forEach(project.sourceIds, (s, i) =>
          Effect.map(sources.get(s).pipe(Effect.option), (found) => Option.match(found, { onNone: () => `video ${i + 1}`, onSome: (v) => v.title ?? `video ${i + 1}` })))
        const problem = removalProblem(yield* currentWork(id), index, names)
        if (problem !== null) return yield* new ProjectSourceInUse({ message: problem })
        const now = DateTime.formatIso(yield* DateTime.now)
        // the videos after it move up one by one, so no two share a place on the way
        yield* sql.withTransaction(Effect.gen(function*() {
          yield* sql`DELETE FROM project_sources WHERE project_id = ${id} AND source_id = ${sourceId}`
          for (let position = index + 1; position < project.sourceIds.length; position++) {
            yield* sql`UPDATE project_sources SET position = ${position - 1} WHERE project_id = ${id} AND position = ${position}`
          }
          yield* sql`UPDATE projects SET updated_at = ${now} WHERE id = ${id}`
        })).pipe(Effect.orDie)
        return yield* get(id)
      })

      const remove = Effect.fn("Projects.remove")(function*(id: ProjectId) {
        const deleted = yield* sql`DELETE FROM projects WHERE id = ${id} RETURNING id`
        if (deleted.length === 0) return false
        yield* fs.remove(home.projectDir(id), { recursive: true, force: true })
        return true
      }, Effect.orDie)

      return Projects.of({
        create,
        fromProposal,
        fromSetProposal,
        setBrief,
        setVoice,
        setPreset,
        setMusic,
        addSource,
        removeSource,
        list,
        get,
        remove
      })
    })
  ).pipe(
    Layer.provide([Sources.layer, Presets.layer, MusicLibrary.layer, Artifacts.layer, Settings.layer, VideoSets.layer, RunStore.layer]),
    Layer.provide([DatabaseLive, ViralHome.layer, NodeServices.layer, SecureRandom.layerWebCrypto])
  )
}
