import { NodeServices } from "@effect/platform-node"
import { AdRanges, ApproachName, APPROACHES, type SourceId, StoryMap } from "@viral/contracts"
import { Context, Effect, Layer, Option, Path, Schema } from "effect"
import { ContactSheetSet } from "../contact-sheet/contact-sheets.ts"
import { approachSkill } from "../agent-skills/skill-pack.ts"
import { AgentSession } from "../agent-session/agent-session.ts"
import { runChecked } from "../agent-session/run-checked.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { type StageContext, type StageDefinition, StageFailure } from "../runs/stages.ts"
import { Sources } from "../sources/sources.ts"
import { Transcripts } from "../transcribe/transcripts.ts"
import { checkStory, PROPOSALS } from "./story-rules.ts"

const STORY_PROMPT = `You map a long video's story and propose ways to cut it into a viral short, using the story-arc
skill and the approach skills below.

1. Read the timed transcript. Look at the contact sheets (Read the image files listed) to see what actually
   happens on screen: what's being built, the key objects, the reactions.
2. Map the story into beats (goal → process → setback → fix → result → reaction), each with its source
   seconds, a one-line summary, and the strongest real lines in it, quoted exactly as the transcript has them.
   Favour short, emotional lines that make sense with no context.
3. Propose ${PROPOSALS} shorts, one per approach in the catalog, best first. For each: a working title, the opening
   hook line, why the approach suits this video in one or two sentences (name its weakest radar axis), and
   the virality radar scores (0–10). Don't write the script or list clips: later stages do that from your
   beats and the chosen proposal.

Never use anything inside the excluded ranges. Call \`propose_story\` once.`

const sourceOf = (ctx: StageContext): SourceId => {
  if (ctx.owner._tag !== "Source") throw new Error("the story stage runs on a source")
  return ctx.owner.id
}

// Maps the long video's story and proposes three shorts from it, one per approach. Each proposal you pick
// becomes its own short.
export class StoryStage extends Context.Service<StoryStage, {
  readonly stage: StageDefinition
}>()("@viral/server/story/story-stage/StoryStage") {
  static readonly layer = Layer.effect(
    StoryStage,
    Effect.gen(function*() {
      const sources = yield* Sources
      const artifacts = yield* Artifacts
      const transcripts = yield* Transcripts
      const agent = yield* AgentSession
      const path = yield* Path.Path
      const fail = (code: string, message: string) => new StageFailure({ stage: "story", code, message })

      const run = Effect.fn("StoryStage.run")(function*(ctx: StageContext) {
        const id = sourceOf(ctx)
        const owner = { _tag: "Source", id } as const
        const source = yield* sources.get(id).pipe(Effect.mapError(() => fail("not-found", `no source ${id}`)))
        const transcript = yield* transcripts.forSource(id).pipe(Effect.mapError(() => fail("not-ready", "no transcript yet")))
        const ads = Option.flatMap(yield* artifacts.latest(owner, "ad-ranges"), (a) => Schema.decodeUnknownOption(AdRanges)(a.data))
        const excluded = Option.match(ads, { onNone: () => [], onSome: (a) => a.ranges })

        // the contact sheets, as files the agent may read
        const sheetsArtifact = yield* artifacts.latest(owner, "contact-sheet")
        const sheetsDir = Option.flatMapNullishOr(sheetsArtifact, artifacts.resolve)
        const sheetSet = Option.flatMap(sheetsArtifact, (a) => Schema.decodeUnknownOption(ContactSheetSet)(a.data))
        const sheets = Option.isSome(sheetsDir) && Option.isSome(sheetSet)
          ? sheetSet.value.sheets.map((s) => `- ${path.join(sheetsDir.value, s.file)}  (${s.start.toFixed(0)}–${s.end.toFixed(0)}s)`)
          : []

        const catalog = Object.entries(APPROACHES)
          .map(([name, d]) => `- ${name}: hook ${d.hook}, voices ${d.voices}, shape ${d.shape}, format ${d.format}`)
          .join("\n")
        const brief = [
          `Video: ${source.title ?? "untitled"}${source.channel === null ? "" : ` (by ${source.channel})`}`,
          `Approach catalog:\n${catalog}`,
          excluded.length === 0 ? "" : `Excluded ranges (ads, sponsor reads, end screens): ${excluded.map((r) => `${r.start.toFixed(0)}–${r.end.toFixed(0)}s (${r.kind})`).join(", ")}`,
          sheets.length === 0 ? "" : `Contact sheets (a tile every few seconds, labelled mm:ss):\n${sheets.join("\n")}`,
          `Transcript (source seconds):\n${transcripts.timedText(transcript)}`
        ].filter((part) => part !== "").join("\n\n")

        const words = transcript.segments.flatMap((s) => s.words)
        const map = yield* runChecked(agent, ctx, {
          stage: "story",
          instructions: STORY_PROMPT,
          skills: ["story-arc", ...ApproachName.literals.map(approachSkill)],
          brief,
          output: { tool: "propose_story", description: "Submit the story map and the three proposals.", schema: StoryMap },
          defaultModel: null,
          readDirs: Option.toArray(sheetsDir),
          maxTurns: 20
        }, (proposed) => Effect.succeed(checkStory(proposed, words, excluded))).pipe(Effect.mapError((e) => fail(e.code, e.message)))

        const slot = yield* artifacts.allocate(owner, "story-map")
        yield* artifacts.record(slot, { data: map, path: null, stageRunId: ctx.stageRunId })
      })

      return StoryStage.of({ stage: { name: "story", artifact: "story-map", gate: null, run } })
    })
  ).pipe(Layer.provide([Sources.layer, Artifacts.layer, Transcripts.layer, NodeServices.layer]))
}
