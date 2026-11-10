import { NodeServices } from "@effect/platform-node"
import {
  type Artifact,
  type GatePayload,
  looksLikeRanking,
  type ProposedShortlist,
  Shortlist,
  type SourceSetId,
  youTubeId
} from "@viral/contracts"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { AgentSession } from "../agent-session/agent-session.ts"
import { runChecked } from "../agent-session/run-checked.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { VideoSets } from "../video-sets/video-sets.ts"
import { emptyCatalog, isDetails, type ResearchCatalog, researchTools } from "./research-tools.ts"
import { researchTask } from "./research-task.ts"
import { Researches } from "./researches.ts"
import { checkShortlist, checkShortlistEdit } from "./shortlist-rules.ts"
import { YouTube } from "./youtube.ts"

const setOf = (ctx: StageContext): SourceSetId => {
  if (ctx.owner._tag !== "Set") throw new Error("the research stage runs on a video set")
  return ctx.owner.id
}

// The research stage, a research set's first step: the agent searches YouTube from your idea and proposes the
// videos (exactly as many as you asked for, plus up to 3 backups); the server checks the list against what YouTube
// said, saves each video's thumbnail, and the list waits for you ("Download these videos?"). Approving it (or your
// changed version) makes the videos the set's videos; the run then reads them and proposes shorts across them.
export class ResearchStage extends Context.Service<ResearchStage, {
  readonly stage: StageDefinition
}>()("@viral/server/research/research-stage/ResearchStage") {
  static readonly layer = Layer.effect(
    ResearchStage,
    Effect.gen(function*() {
      const sets = yield* VideoSets
      const artifacts = yield* Artifacts
      const agent = yield* AgentSession
      const youtube = yield* YouTube
      const researches = yield* Researches
      const fail = (code: string, message: string) => new StageFailure({ stage: "research", code, message })
      // each set's searches and lookups, kept while its research continues a conversation (a rejection with a note)
      const catalogs = new Map<SourceSetId, ResearchCatalog>()
      const replacings = new Map<SourceSetId, { readonly previous: Shortlist; readonly videoId: string; readonly reason: string }>()

      // Looks up, one at a time, every video on the proposed list that only a search has seen (so its length, live
      // state and existence are YouTube's answer) and any id the agent knows from an earlier conversation.
      // every pick and backup looked up (a ranking's picks with their captions, for the interview-lines rule)
      const verify = (proposed: ProposedShortlist, catalog: ResearchCatalog, ranking: boolean) =>
        Effect.forEach([...proposed.picks.map((p) => ({ p, pick: true })), ...proposed.backups.map((p) => ({ p, pick: false }))], ({ p: pick, pick: isPick }) => {
          const id = youTubeId(pick.video)
          if (id === null || catalog.unavailable.has(id) || catalog.blocked !== null) return Effect.void
          const known = catalog.videos.get(id)
          const captions = ranking && isPick
          if (known !== undefined && isDetails(known) && (!captions || known.captions !== null)) return Effect.void
          return youtube.details(id, { captions }).pipe(
            Effect.tap((details) => Effect.sync(() => void catalog.videos.set(id, details))),
            Effect.catchTag("YouTubeError", (error) =>
              Effect.sync(() => {
                if (error.kind === "blocked") catalog.blocked = error.message
                else catalog.unavailable.set(id, error.message)
              })),
            Effect.asVoid
          )
        }, { discard: true })

      const run = Effect.fn("ResearchStage.run")(function*(ctx: StageContext) {
        const id = setOf(ctx)
        const set = yield* sets.get(id).pipe(Effect.mapError(() => fail("not-found", `no video set ${id}`)))
        if (set.research === null) return yield* fail("not-research", "this set wasn't found from an idea")
        const research = set.research
        const latest = Option.getOrNull(yield* researches.latest(id))
        // a replacement asked for with "Replace this video"; a rejected attempt of it is still one
        const replacing = latest !== null && latest.replacing !== null
          ? { previous: latest, videoId: latest.replacing.videoId, reason: latest.replacing.reason }
          : ctx.note !== null ? replacings.get(id) ?? null : null
        if (replacing === null) replacings.delete(id)
        else replacings.set(id, replacing)

        const catalog = ctx.resumeSession !== null ? catalogs.get(id) ?? emptyCatalog() : emptyCatalog()
        catalogs.set(id, catalog)
        // the approved videos are known: the replacement keeps them in place
        for (const p of replacing?.previous.picks ?? []) {
          if (!catalog.videos.has(p.videoId)) {
            catalog.videos.set(p.videoId, { videoId: p.videoId, title: p.title, channel: p.channel, durationS: p.durationS, views: p.views, live: false })
          }
        }

        yield* ctx.progress(null, replacing === null ? `searching YouTube for "${research.idea}"` : "searching YouTube for a replacement")
        const checked = yield* runChecked(
          agent,
          ctx,
          researchTask({ research, tools: researchTools(youtube, catalog, (message) => ctx.progress(null, message)), replacing }),
          (proposed) =>
            verify(proposed, catalog, looksLikeRanking(research.idea)).pipe(
              Effect.map(() =>
                checkShortlist(proposed, {
                  count: replacing === null ? research.videos : replacing.previous.picks.length,
                  videos: catalog.videos,
                  unavailable: catalog.unavailable,
                  searches: catalog.searches,
                  idea: research.idea,
                  ranking: looksLikeRanking(research.idea),
                  replacing: replacing === null ? null : { previous: replacing.previous, videoId: replacing.videoId }
                })
              )
            )
        ).pipe(Effect.mapError((e) => fail(e.code, e.message)))

        yield* ctx.progress(null, "saving the thumbnails")
        const list = yield* researches.withThumbnails(id, checked)
        const slot = yield* artifacts.allocate(ctx.owner, "shortlist")
        yield* artifacts.record(slot, { data: list, path: null, stageRunId: ctx.stageRunId })
      })

      // Your changed list: checked again (2–10 videos, none twice, none too long, at most 3 backups), thumbnails for the
      // links you added, and recorded as the version you approve.
      const applyEdit = Effect.fn("ResearchStage.applyEdit")(function*(ctx: StageContext, edited: unknown) {
        const id = setOf(ctx)
        const list = yield* Schema.decodeUnknownEffect(Shortlist)(edited).pipe(Effect.mapError((e) => fail("invalid-edit", e.message)))
        const problems = checkShortlistEdit(list)
        if (problems.length > 0) return yield* fail("invalid-edit", problems.join(" "))
        const slot = yield* artifacts.allocate(ctx.owner, "shortlist")
        yield* artifacts.record(slot, { data: yield* researches.withThumbnails(id, { ...list, replacing: null }), path: null, stageRunId: ctx.stageRunId })
      })

      // Once you approve, the videos join your library (footage not yours, rights not confirmed, channels kept for
      // the credits; a video already there is reused) and become the set's videos in your order. Downloading starts
      // as the run goes on to read them.
      const approved = Effect.fn("ResearchStage.approved")(function*(ctx: StageContext) {
        const id = setOf(ctx)
        const list = Option.getOrNull(yield* researches.latest(id))
        if (list === null) return yield* fail("not-ready", "there's no shortlist to approve")
        replacings.delete(id)
        yield* researches.adopt(id, list, ctx.stageRunId).pipe(
          Effect.mapError((e) => fail(e._tag === "VideoSetNotFound" ? "not-found" : "invalid", e._tag === "VideoSetNotFound" ? `no video set ${id}` : e.message))
        )
      })

      const stage: StageDefinition = {
        name: "research",
        artifact: "shortlist",
        gate: "Download these videos?",
        beforePrerequisites: true,
        run,
        applyEdit,
        approved,
        gatePayload: (artifact: Artifact): GatePayload =>
          Option.match(Schema.decodeUnknownOption(Shortlist)(artifact.data), {
            onNone: () => ({ _tag: "ArtifactGate", artifact }),
            onSome: (shortlist) => ({ _tag: "ShortlistGate", shortlist })
          })
      }
      return ResearchStage.of({ stage })
    })
  ).pipe(Layer.provide([Researches.layer, VideoSets.layer, Artifacts.layer, YouTube.layer, NodeServices.layer]))
}
