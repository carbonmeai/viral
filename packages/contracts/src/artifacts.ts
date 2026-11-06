import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { ProjectId } from "./projects.ts"
import { ReferenceVideoId } from "./references.ts"
import { SourceId } from "./sources.ts"

export const ArtifactId = Schema.String.pipe(Schema.brand("ArtifactId"))
export type ArtifactId = typeof ArtifactId.Type

// Source-level artifacts are made once per long video, project-level ones per short, reference-level ones
// per reference video.
export const SourceArtifactKind = Schema.Literals(["source-video", "transcript", "contact-sheet", "ad-ranges", "story-map"])
export type SourceArtifactKind = typeof SourceArtifactKind.Type

export const ProjectArtifactKind = Schema.Literals([
  "script",
  "shot-plan",
  "cut-plan",
  "voiceover",
  "voiceover-transcript",
  "narrated-plan",
  // a cut-down short's assembled plan, the renderer's input (render-short.py)
  "cut-render-plan",
  "music-config",
  // a short's own music, fitted from a library song (fit-music.py)
  "music-bed",
  "render",
  "captions",
  "metadata",
  "thumb-config",
  "thumbnail",
  "sound-cues"
])
export type ProjectArtifactKind = typeof ProjectArtifactKind.Type

// A reference video's own download and its analysis.
export const ReferenceArtifactKind = Schema.Literals(["reference-video", "reference-analysis"])
export type ReferenceArtifactKind = typeof ReferenceArtifactKind.Type

export const ArtifactKind = Schema.Union([SourceArtifactKind, ProjectArtifactKind, ReferenceArtifactKind])
export type ArtifactKind = typeof ArtifactKind.Type

export const ArtifactOwner = Schema.Union([
  Schema.TaggedStruct("Source", { id: SourceId }),
  Schema.TaggedStruct("Project", { id: ProjectId }),
  Schema.TaggedStruct("Reference", { id: ReferenceVideoId })
])
export type ArtifactOwner = typeof ArtifactOwner.Type

// One version of a stage output. `path` is relative to the owner's folder; `data` holds structured
// output and is decoded with the kind's schema by whoever reads it.
export const Artifact = Schema.Struct({
  id: ArtifactId,
  owner: ArtifactOwner,
  kind: ArtifactKind,
  version: Schema.Int,
  data: Schema.NullOr(Schema.Unknown),
  path: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString
})
export type Artifact = typeof Artifact.Type

export class ArtifactsRpcs extends RpcGroup.make(
  // Every version of every artifact the owner has, newest first within each kind.
  Rpc.make("ListArtifacts", { payload: { owner: ArtifactOwner }, success: Schema.Array(Artifact) })
) {}
