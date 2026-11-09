import { NodeServices } from "@effect/platform-node"
import {
  type Artifact,
  type ArtifactOwner,
  type GatePayload,
  type ProjectId,
  ProposedRanking,
  RankingPlan,
  RankingProposal,
  Shortlist
} from "@viral/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { agentTool, AgentSession } from "../agent-session/agent-session.ts"
import { runChecked } from "../agent-session/run-checked.ts"
import { approachSkill } from "../agent-skills/skill-pack.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { ContactSheets, ContactSheetSet } from "../contact-sheet/contact-sheets.ts"
import { detailSheetTool } from "../contact-sheet/detail-sheet-tool.ts"
import { ViralHome } from "../home/viral-home.ts"
import { type ProjectSource, ProjectSources } from "../projects/project-sources.ts"
import { Projects } from "../projects/projects.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { VideoSets } from "../video-sets/video-sets.ts"
import {
  checkRanking,
  framingKey,
  fromProposedRanking,
  type RankingContext,
  type RankingDraft,
  rankingMaxSeconds,
  type RankingVideo
} from "./moment-rules.ts"
import { buildMomentsBrief, momentsPrompt } from "./moments-prompt.ts"
import { type DrawnRanking, frameFindings, RankingFrames } from "./ranking-frames.ts"

const fail = (code: string, message: string) => new StageFailure({ stage: "moments", code, message })
const failWith = (code: string) => (error: { readonly message: string }) => fail(code, error.message)

const projectOf = (ctx: StageContext): ProjectId => {
  if (ctx.owner._tag !== "Project") throw new Error("the moments stage runs on a project")
  return ctx.owner.id
}

const fmt = (t: number) => t.toFixed(1)

// "#3 shot 2 (care, V2 41.0–44.5s)"
const shotName = (draft: RankingDraft, several: boolean) => (rank: number, k: number) => {
  const entry = draft.entries.find((e) => e.rank === rank)
  const shot = entry?.shots[k]
  if (entry === undefined || shot === undefined) return `#${rank} shot ${k + 1}`
  return `#${rank} shot ${k + 1} (${shot.role}, ${several ? `V${(entry.source ?? 0) + 1} ` : ""}${fmt(shot.start)}–${fmt(shot.end)}s)`
}

// Picks a ranking short's moments: an agent with vision picks each video's before, care and after shots, ranks the
// entries, labels them and writes the title. The server snaps every cut to whole sentences of that video's
// transcript, checks the ranking, draws every shot's first and last frame (a black frame is a problem; ends that look
// like different scenes go back to the agent to look at, and stay flagged for you), and draws the storyboard for the
// gate.
export class MomentsStage extends Context.Service<MomentsStage, {
  readonly stage: StageDefinition
}>()("@viral/server/moments/moments-stage/MomentsStage") {
  static readonly layer = Layer.effect(
    MomentsStage,
    Effect.gen(function*() {
      const projects = yield* Projects
      const projectSources = yield* ProjectSources
      const sets = yield* VideoSets
      const artifacts = yield* Artifacts
      const contactSheets = yield* ContactSheets
      const frames = yield* RankingFrames
      const agent = yield* AgentSession
      const home = yield* ViralHome
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      // Everything the ranking is made from and checked against.
      const context = Effect.fn("MomentsStage.context")(function*(projectId: ProjectId) {
        const project = yield* projects.get(projectId).pipe(Effect.mapError(() => fail("not-found", "no such project")))
        if (project.format !== "ranking") return yield* fail("wrong-approach", `${project.approach} shorts aren't rankings`)
        const sources = yield* projectSources.of(project).pipe(Effect.mapError(() => fail("not-found", "no such source")))
        const name = (s: ProjectSource) => s.source.title ?? `video ${s.index + 1}`
        const unfetched = sources.filter((s) => Option.isNone(s.video)).map(name)
        if (unfetched.length > 0) return yield* fail("not-ready", `${unfetched.join(", ")} hasn't been downloaded`)
        const untranscribed = sources.filter((s) => Option.isNone(s.transcript)).map(name)
        if (untranscribed.length > 0) return yield* fail("not-ready", `${untranscribed.join(", ")} has no transcript`)
        const videos = sources.map((s) => Option.getOrThrow(s.video))
        const set = project.setId === null ? Option.none() : yield* sets.get(project.setId).pipe(Effect.option)
        const research = Option.flatMapNullishOr(set, (s) => s.research)
        const maxSeconds = rankingMaxSeconds(Option.match(research, { onNone: () => null, onSome: (r) => r.length }))
        const ranking: ReadonlyArray<RankingVideo> = yield* Effect.forEach(sources, (s, i) =>
          Effect.map(frames.ofVideo(s.source.id, videos[i]!), (framing) => ({ words: s.words, seconds: s.seconds, excluded: s.excluded, framing })),
          { concurrency: 4 })
        return { project, sources, videos, ranking, maxSeconds, research: Option.getOrNull(research) }
      })
      type Ctx = Effect.Success<ReturnType<typeof context>>

      // the checks with the framing detected at each shot's moment
      const check = Effect.fn("MomentsStage.check")(function*(c: Ctx, proposal: RankingProposal) {
        const detected = yield* frames.atShots(c.videos, proposal)
        const rankingContext: RankingContext = {
          videos: c.ranking,
          maxSeconds: c.maxSeconds,
          framingAt: (source, start, end) => detected.get(framingKey(source, start, end)) ?? null
        }
        return checkRanking(proposal, rankingContext)
      })

      // The plan as recorded: each shot with its two frames, and the shots whose ends look like different scenes
      // flagged for your eye.
      const toPlan = (c: Ctx, draft: RankingDraft, drawn: DrawnRanking | null): RankingPlan => {
        const several = c.sources.length > 1
        const findings = drawn === null ? { black: [], drift: [] } : frameFindings(draft, drawn, shotName(draft, several))
        return {
          ...draft,
          entries: draft.entries.map((entry, e) => ({
            ...entry,
            shots: entry.shots.map((shot, k) => ({
              ...shot,
              firstFrame: drawn?.shots[e]?.[k]?.first ?? null,
              lastFrame: drawn?.shots[e]?.[k]?.last ?? null
            }))
          })),
          storyboard: drawn?.storyboard ?? null,
          warnings: [...findings.black, ...findings.drift.map((d) => `${d.message}; check it shows the right animal throughout`)]
        }
      }

      const record = Effect.fn("MomentsStage.record")(function*(ctx: StageContext, c: Ctx, draft: RankingDraft) {
        const slot = yield* artifacts.allocate(ctx.owner, "ranking-plan")
        yield* ctx.progress(null, "drawing every shot's first and last frame")
        const drawn = yield* frames.draw(c.videos, draft, slot.dir)
        const plan = toPlan(c, draft, drawn)
        yield* artifacts.record(slot, {
          data: plan,
          path: plan.storyboard === null ? null : path.join(slot.relDir, plan.storyboard),
          stageRunId: ctx.stageRunId
        })
      })

      // What the frames say about a checked ranking the agent sent: black ends are problems; ends that look like
      // different scenes are problems until the agent says it looked (framesChecked).
      const frameProblems = Effect.fn("MomentsStage.frameProblems")(function*(
        c: Ctx,
        proposed: ProposedRanking,
        draft: RankingDraft,
        dir: string
      ) {
        const drawn = yield* frames.draw(c.videos, draft, dir)
        if (drawn === null) return { drawn, problems: [] as Array<string> }
        const findings = frameFindings(draft, drawn, shotName(draft, c.sources.length > 1))
        const unchecked = findings.drift.flatMap((d) => {
          if (proposed.entries[d.entry]?.shots[d.shot]?.framesChecked === true) return []
          const shot = drawn.shots[d.entry]![d.shot]!
          const entry = draft.entries[d.entry]!
          return [
            `${d.message}. Read ${path.join(dir, shot.first)} and ${path.join(dir, shot.last)}: if both show #${entry.rank}'s animal in its ${
              entry.shots[d.shot]!.role
            } state, set framesChecked: true on that shot; otherwise move or shorten it`
          ]
        })
        return { drawn, problems: [...findings.black, ...unchecked] }
      })

      // The agent's self-check: the ranking's problems, or every shot's first and last frame drawn so it can look.
      const previewTool = (c: Ctx, root: string, attempt: number) => {
        let drawnCount = 0
        return agentTool({
          name: "preview_moments",
          description: "Check a ranking, snap its cuts to whole sentences and draw every shot's first and last frame. Returns the problems to fix, or the storyboard and frame files to Read.",
          schema: ProposedRanking,
          run: Effect.fn("MomentsStage.preview")(function*(proposed: ProposedRanking) {
            const checked = yield* check(c, fromProposedRanking(proposed))
            if (checked.problems.length > 0) return `Fix these first:\n${checked.problems.map((p) => `- ${p}`).join("\n")}`
            const dir = path.join(root, `attempt-${attempt}-${++drawnCount}`)
            const { drawn, problems } = yield* frameProblems(c, proposed, checked.value, dir)
            const draft = checked.value
            if (drawn === null) return `The ranking passes the checks (${fmt(draft.durationS)}s), but its frames couldn't be drawn; submit it.`
            const name = shotName(draft, c.sources.length > 1)
            const lines = draft.entries.flatMap((entry, e) =>
              entry.shots.map((shot, k) =>
                `- ${name(entry.rank, k)} "${shot.text.slice(0, 60)}": first ${path.join(dir, drawn.shots[e]![k]!.first)}, last ${path.join(dir, drawn.shots[e]![k]!.last)}`
              )
            )
            return [
              `The ranking runs ${fmt(draft.durationS)}s once snapped (within ${fmt(c.maxSeconds)}s). Storyboard (every shot's first and last frame, in playing order ${draft.order.join(", ")}): ${path.join(dir, drawn.storyboard)}`,
              problems.length === 0 ? "" : `Look at these:\n${problems.map((p) => `- ${p}`).join("\n")}`,
              `Each shot as snapped, with its words and frames:\n${lines.join("\n")}`,
              "Read the storyboard. Fix any shot whose ends show the wrong animal or state, then call propose_moments."
            ].filter((part) => part !== "").join("\n\n")
          })
        })
      }

      // a video's overview contact sheets, as lines for the brief, and their folder for the agent to read
      const overviewSheets = Effect.fn("MomentsStage.overviewSheets")(function*(owner: ArtifactOwner) {
        const sheetsArtifact = yield* artifacts.latest(owner, "contact-sheet")
        const sheetsDir = Option.flatMapNullishOr(sheetsArtifact, artifacts.resolve)
        const sheetSet = Option.flatMap(sheetsArtifact, (a) => Schema.decodeUnknownOption(ContactSheetSet)(a.data))
        const sheets = Option.isSome(sheetsDir) && Option.isSome(sheetSet)
          ? sheetSet.value.sheets.map((s) => `- ${path.join(sheetsDir.value, s.file)}  (${s.start.toFixed(0)}–${s.end.toFixed(0)}s)`)
          : []
        return { sheets, dir: sheetsDir }
      })

      const run = Effect.fn("MomentsStage.run")(function*(ctx: StageContext) {
        const c = yield* context(projectOf(ctx))
        const overviews = yield* Effect.forEach(c.sources, (s) => overviewSheets(s.owner))
        // the research's shortlist: each video's part in the idea and the moments it expected
        const shortlist = c.project.setId === null
          ? Option.none()
          : Option.flatMap(yield* artifacts.latest({ _tag: "Set", id: c.project.setId }, "shortlist"), (a) => Schema.decodeUnknownOption(Shortlist)(a.data))
        const pickOf = (s: ProjectSource) => Option.flatMapNullishOr(shortlist, (l) => l.picks.find((p) => p.sourceId === s.source.id))

        const projectDir = home.projectDir(c.project.id)
        const detailRoot = path.join(projectDir, "moments-detail")
        const previewRoot = path.join(projectDir, "moments-preview")
        const checkRoot = path.join(projectDir, "moments-check")
        yield* Effect.forEach([detailRoot, previewRoot, checkRoot], (dir) => fs.makeDirectory(dir, { recursive: true }), { discard: true }).pipe(
          Effect.mapError(failWith("write"))
        )
        const brief = buildMomentsBrief({
          creatorBrief: c.project.brief,
          idea: c.research?.idea ?? null,
          workingTitle: c.project.title,
          maxSeconds: c.maxSeconds,
          videos: c.sources.map((s, i) => ({
            title: s.source.title,
            channel: s.source.channel,
            seconds: s.seconds,
            transcript: Option.getOrNull(s.transcript),
            excluded: s.ads,
            part: Option.getOrNull(Option.map(pickOf(s), (p) => p.part)),
            expected: Option.match(pickOf(s), { onNone: () => [], onSome: (p) => p.moments }),
            framing: c.ranking[i]!.framing,
            sheets: overviews[i]!.sheets
          }))
        })
        let checks = 0
        const draft = yield* runChecked(agent, ctx, {
          stage: "moments",
          instructions: momentsPrompt(c.maxSeconds, c.sources.length),
          skills: ["story-arc", approachSkill("ranking")],
          brief,
          output: { tool: "propose_moments", description: "Submit the whole ranking.", schema: ProposedRanking },
          tools: [
            detailSheetTool(contactSheets, path, c.sources.map((s, i) => ({ video: c.videos[i]!, seconds: s.seconds })), c.sources[0].seconds, detailRoot),
            previewTool(c, previewRoot, ctx.attempt)
          ],
          defaultModel: null,
          readDirs: [...overviews.flatMap((o) => Option.toArray(o.dir)), detailRoot, previewRoot, checkRoot],
          maxTurns: 80
        }, (proposed) =>
          Effect.gen(function*() {
            const checked = yield* check(c, fromProposedRanking(proposed))
            if (checked.problems.length > 0) return checked
            const { problems } = yield* frameProblems(c, proposed, checked.value, path.join(checkRoot, `attempt-${ctx.attempt}-${++checks}`))
            return { value: checked.value, problems }
          })).pipe(Effect.mapError((e) => fail(e.code, e.message)))
        yield* record(ctx, c, draft)
      })

      // An edit sends back the ranking (ranks, labels, shots, order); it's snapped and checked again, and its frames
      // drawn afresh.
      const applyEdit = Effect.fn("MomentsStage.applyEdit")(function*(ctx: StageContext, edited: unknown) {
        const proposal = yield* Schema.decodeUnknownEffect(RankingProposal)(edited).pipe(Effect.mapError(failWith("invalid-edit")))
        const c = yield* context(projectOf(ctx))
        const checked = yield* check(c, proposal)
        if (checked.problems.length > 0) return yield* fail("invalid-edit", checked.problems.join("; "))
        yield* record(ctx, c, checked.value)
      })

      const stage: StageDefinition = {
        name: "moments",
        artifact: "ranking-plan",
        gate: "Approve the moments?",
        run,
        applyEdit,
        gatePayload: (artifact: Artifact): GatePayload =>
          Option.match(Schema.decodeUnknownOption(RankingPlan)(artifact.data), {
            onNone: () => ({ _tag: "ArtifactGate", artifact }),
            onSome: (plan) => ({ _tag: "RankingGate", plan, storyboard: artifacts.resolve(artifact) })
          })
      }
      return MomentsStage.of({ stage })
    })
  ).pipe(Layer.provide([
    Projects.layer,
    ProjectSources.layer,
    Artifacts.layer,
    ContactSheets.layer,
    VideoSets.layer,
    RankingFrames.layer,
    ViralHome.layer,
    NodeServices.layer
  ]))
}
