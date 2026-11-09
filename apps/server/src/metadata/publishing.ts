import { NodeServices } from "@effect/platform-node"
import {
  NotPublished,
  PostText,
  PostTextInvalid,
  type Project,
  type ProjectId,
  type ProjectNotFound,
  PublishedShort,
  type PublishStatus,
  PublishUnavailable,
  RenderedShort,
  type Run
} from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ViralHome } from "../home/viral-home.ts"
import { Presets } from "../presets/presets.ts"
import { creditLine, loadAppearanceOrder } from "../projects/credits.ts"
import { Projects, sourcesOf } from "../projects/projects.ts"
import { RunManager } from "../runs/run-manager.ts"
import { RunStore } from "../runs/run-store.ts"
import { StageFailure } from "../runs/stages.ts"
import { Settings } from "../settings/settings.ts"
import { Sources } from "../sources/sources.ts"
import { publishedNames, writePublished } from "./publish-files.ts"
import { checkPost, postCredit, postKey, publishChanges } from "./publish-rules.ts"

// The credit an assembled plan draws on the video (either format's plan has it as `credit`).
const PlannedCredit = Schema.Struct({ credit: Schema.optionalKey(Schema.String) })

export type PublishAgainResult =
  | { readonly _tag: "Published"; readonly status: PublishStatus }
  | { readonly _tag: "Rendering"; readonly run: Run }

// A published short's post text and publishing it again: the title you chose (or typed) and your edits are kept
// per short; "publish again" rewrites the short's files in the renders folder with them, the credit as it is now
// and the latest render, re-rendering first (assemble and render, no agents) when the credit drawn on the video
// changed.
export class Publishing extends Context.Service<Publishing, {
  status(projectId: ProjectId): Effect.Effect<PublishStatus, ProjectNotFound | NotPublished>
  // saves the text to post with (null: back to the agent's), checked first
  setPost(projectId: ProjectId, post: PostText | null): Effect.Effect<PublishStatus, ProjectNotFound | NotPublished | PostTextInvalid>
  publishAgain(projectId: ProjectId): Effect.Effect<PublishAgainResult, ProjectNotFound | NotPublished | PublishUnavailable>
}>()("@viral/server/metadata/publishing") {
  static readonly layer = Layer.effect(
    Publishing,
    Effect.gen(function*() {
      const projects = yield* Projects
      const sources = yield* Sources
      const presets = yield* Presets
      const artifacts = yield* Artifacts
      const settings = yield* Settings
      const store = yield* RunStore
      const runs = yield* RunManager
      const home = yield* ViralHome
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const ownerOf = (id: ProjectId) => ({ _tag: "Project", id }) as const

      // Everything publishing reads, as it is now.
      const current = Effect.fn("Publishing.current")(function*(project: Project) {
        const owner = ownerOf(project.id)
        const metadataArtifact = yield* artifacts.latest(owner, "metadata")
        const published = Option.flatMap(metadataArtifact, (a) => Schema.decodeUnknownOption(PublishedShort)(a.data))
        if (Option.isNone(published) || Option.isNone(metadataArtifact)) return yield* new NotPublished({ id: project.id })
        const videos = yield* Effect.forEach(sourcesOf(project), (id) => sources.get(id).pipe(Effect.orDie))
        const preset = project.presetId === null
          ? yield* presets.getDefault
          : yield* presets.get(project.presetId).pipe(Effect.catch(() => presets.getDefault))
        const renderArtifact = yield* artifacts.latest(owner, "render")
        const render = Option.flatMap(renderArtifact, (a) => Schema.decodeUnknownOption(RenderedShort)(a.data))
        const planArtifact = yield* artifacts.latest(owner, project.format === "cut-down" ? "cut-render-plan" : "narrated-plan")
        const planned = Option.flatMap(planArtifact, (a) => Schema.decodeUnknownOption(PlannedCredit)(a.data))
        const saved = yield* settings.get(postKey(project.id), PostText)
        const names = publishedNames(project.slug)
        const present = yield* Effect.forEach(names, (n) => fs.exists(path.join(home.renders, n)).pipe(Effect.orElseSucceed(() => false)))
        const going = (yield* store.listRuns(owner)).some((r) => r.status === "running" || r.status === "waiting")
        // the channels whose footage plays, in the order it first appears, as the video credits them
        const order = yield* loadAppearanceOrder(project, artifacts)
        const credit = postCredit(videos, order)
        const outcome = publishChanges({
          published: published.value,
          saved: Option.getOrNull(saved),
          credit,
          // a short assembled before plans recorded their credit can't tell, so it isn't re-rendered for it
          drawnCredit: Option.match(planned, {
            onNone: () => null,
            onSome: (p) => ({ now: preset.config.credit ? creditLine(videos, order) : null, planned: p.credit ?? null })
          }),
          // older versions didn't record which render they copied: a render made after them is newer
          newerRender: Option.match(renderArtifact, {
            onNone: () => false,
            onSome: (a) =>
              published.value.renderVersion === undefined
                ? a.createdAt.epochMilliseconds > metadataArtifact.value.createdAt.epochMilliseconds
                : a.version > published.value.renderVersion
          }),
          missing: present.some((p) => !p)
        })
        const old = [published.value.video, published.value.captions, published.value.notes].map((f) => path.basename(f))
        const status: PublishStatus = {
          post: outcome.post,
          edited: outcome.edited,
          credit,
          changes: outcome.changes,
          rerender: outcome.rerender,
          files: names,
          replaces: old.filter((f) => !names.includes(f)),
          busy: going
        }
        return { status, published: published.value, render, renderArtifact, preset }
      })

      const status = Effect.fn("Publishing.status")(function*(projectId: ProjectId) {
        return (yield* current(yield* projects.get(projectId))).status
      })

      const setPost = Effect.fn("Publishing.setPost")(function*(projectId: ProjectId, post: PostText | null) {
        const project = yield* projects.get(projectId)
        yield* current(project)
        if (post === null) {
          yield* settings.remove(postKey(projectId))
        } else {
          const checked = checkPost(post)
          if (checked.problems.length > 0) return yield* new PostTextInvalid({ problems: checked.problems })
          yield* settings.set(postKey(projectId), checked.value)
        }
        return (yield* current(project)).status
      })

      // Writes the files and records them as a new metadata version (no stage run: it counts as approved, so a
      // later run reuses it).
      const publish = Effect.fn("Publishing.publish")(function*(project: Project) {
        const now = yield* current(project)
        if (Option.isNone(now.render) || Option.isNone(now.renderArtifact)) {
          return yield* new PublishUnavailable({ message: "the short has no render to publish" })
        }
        const { published, notes } = yield* writePublished({ artifacts, fs, path }, {
          slug: project.slug,
          rendersDir: home.renders,
          render: now.render.value,
          renderArtifact: now.renderArtifact.value,
          metadata: now.published,
          post: now.status.post,
          credit: now.status.credit,
          approach: project.approach,
          style: now.preset.name,
          previous: now.published
        }).pipe(Effect.mapError((e) => new PublishUnavailable({ message: `couldn't write the files: ${e.message}` })))
        const slot = yield* artifacts.allocate(ownerOf(project.id), "metadata")
        yield* fs.writeFileString(path.join(slot.dir, `${project.slug}.md`), notes).pipe(
          Effect.mapError((e) => new PublishUnavailable({ message: `couldn't write the files: ${e.message}` }))
        )
        yield* artifacts.record(slot, { data: published, path: path.join(slot.relDir, `${project.slug}.md`) })
        return (yield* current(project)).status
      })

      const publishAgain = Effect.fn("Publishing.publishAgain")(function*(projectId: ProjectId) {
        const project = yield* projects.get(projectId)
        const now = yield* current(project)
        if (now.status.busy) return yield* new PublishUnavailable({ message: "the short is being worked on; publish again once its run is done" })
        if (!now.status.rerender) return { _tag: "Published", status: yield* publish(project) } as const
        // the credit is drawn on the video: assemble and render again (no agents; the render waits for your
        // approval), keep the title and thumbnail, and publish once the run is done
        const run = yield* runs.start(ownerOf(projectId), "assemble", {
          forceThrough: "render",
          andThen: publish(project).pipe(
            Effect.asVoid,
            Effect.mapError((e) =>
              new StageFailure({ stage: "metadata", code: "publish", message: e._tag === "PublishUnavailable" ? e.message : "the short isn't published" })
            )
          )
        }).pipe(Effect.mapError((e) => new PublishUnavailable({ message: e.message })))
        return { _tag: "Rendering", run } as const
      })

      return Publishing.of({ status, setPost, publishAgain })
    })
  ).pipe(Layer.provide([
    Projects.layer,
    Sources.layer,
    Presets.layer,
    Artifacts.layer,
    Settings.layer,
    RunStore.layer,
    ViralHome.layer,
    NodeServices.layer
  ]))
}
