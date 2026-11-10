import { Effect, type Path, Schema } from "effect"
import { checkAds } from "../ads/ad-rules.ts"
import { adsTask } from "../ads/ads-task.ts"
import type { AgentError, AgentRoute, AgentSession } from "../agent-session/agent-session.ts"
import { type Checked, type CheckedTask, runChecked } from "../agent-session/run-checked.ts"
import { checkMetadata } from "../metadata/metadata-rules.ts"
import { metadataTask } from "../metadata/metadata-task.ts"
import type { StageContext } from "../runs/stages.ts"
import { checkScript, fromProposedScript, SCRIPT_LIMITS } from "../script/script-rules.ts"
import { scriptTask } from "../script/script-task.ts"
import { checkStory } from "../story/story-rules.ts"
import { storyTask } from "../story/story-task.ts"
import { timedText } from "../transcribe/transcripts.ts"
import { checkSetStory } from "../set-story/set-story-rules.ts"
import { setStoryTask } from "../set-story/set-story-task.ts"
import { transcriptTools } from "../set-story/transcript-tools.ts"
import type { EvalFixture } from "./eval-fixture.ts"
import { type SetEvalFixture, sheetsDirOf } from "./eval-set-fixture.ts"

// The agent stages an eval can run: the text stages (shots and thumbnail need gateway vision, not built yet). The
// first four run on one video's fixture; set-story runs on its own, on a set fixture (several videos).
export const VideoStageName = Schema.Literals(["ads", "story", "script", "metadata"])
export type VideoStageName = typeof VideoStageName.Type
export const EvalStageName = Schema.Literals([...VideoStageName.literals, "set-story"])
export type EvalStageName = typeof EvalStageName.Type

// One stage, ready to run on any route: the production task and check, built from the fixture.
export interface EvalStage {
  readonly name: EvalStageName
  // the stage's own model on the Claude CLI (the baseline)
  readonly defaultModel: string | null
  // runs the task through the same check-and-fix loop as the pipeline; `onCheck` sees each check's problems
  run(
    agent: AgentSession["Service"],
    ctx: StageContext,
    route: AgentRoute,
    onCheck: (problems: ReadonlyArray<string>) => void
  ): Effect.Effect<unknown, AgentError>
}

const evalStage = <S extends Schema.Codec<unknown, unknown>, A>(
  name: EvalStageName,
  task: CheckedTask<S>,
  check: (proposed: S["Type"]) => Checked<A>
): EvalStage => ({
  name,
  defaultModel: task.defaultModel,
  run: (agent, ctx, route, onCheck) =>
    runChecked(agent, ctx, { ...task, route }, (proposed) =>
      Effect.sync(() => {
        const checked = check(proposed)
        onCheck(checked.problems)
        return checked
      }))
})

export const evalStages = (fixture: EvalFixture, fixtureDir: string, path: Path.Path): Record<VideoStageName, EvalStage> => {
  const transcript = timedText(fixture.transcript)
  const words = fixture.transcript.segments.flatMap((s) => s.words)
  const excluded = fixture.adRanges.ranges
  const sheetsDir = path.join(fixtureDir, "sheets")
  const { source, short } = fixture
  const limits = SCRIPT_LIMITS[short.approach]
  return {
    ads: evalStage("ads", adsTask({ title: source.title, durationS: source.durationS, transcript }), (p) => checkAds(p, source.durationS)),
    story: evalStage(
      "story",
      storyTask({
        title: source.title,
        channel: source.channel,
        excluded,
        sheets: fixture.sheets.map((s) => ({ ...s, file: path.join(sheetsDir, s.file) })),
        sheetsDir,
        transcript
      }),
      (p) => checkStory(p, words, excluded)
    ),
    script: evalStage(
      "script",
      // the built-in styles end with a comment question, so the eval asks for one too
      scriptTask(short.approach, { title: source.title, channel: source.channel, transcript, excluded, angle: short.angle, closingQuestion: true }),
      (p) => {
        if (limits === undefined) return { value: p, problems: [`${short.approach} shorts have no narrated script`] }
        const checked = checkScript(fromProposedScript(p), limits, [{ words, excluded }], true)
        return { value: checked.script, problems: checked.problems }
      }
    ),
    metadata: evalStage(
      "metadata",
      metadataTask({
        title: source.title,
        channel: source.channel,
        summary: fixture.story.summary,
        approach: short.approach,
        durationS: short.durationS,
        workingTitle: short.title,
        lines: short.script.beats.flatMap((b) => b._tag === "Narration" ? [`NARRATOR: ${b.text}`] : b._tag === "Real" ? [`REAL: "${b.quote}"`] : []).join("\n")
      }),
      checkMetadata
    )
  }
}

// The set-story stage on a set fixture: the production task (with its transcript tools and every video's contact
// sheets) and the production check, each video's words and ads from the fixture.
export const setStoryEvalStage = (fixture: SetEvalFixture, fixtureDir: string, path: Path.Path): EvalStage => {
  const videos = fixture.videos.map((v, i) => {
    const sheetsDir = sheetsDirOf(path, fixtureDir, i + 1)
    return {
      title: v.title,
      channel: v.channel,
      seconds: v.durationS,
      transcript: v.transcript,
      excluded: v.adRanges.ranges,
      sheets: v.sheets.map((s) => ({ ...s, file: path.join(sheetsDir, s.file) })),
      sheetsDir,
      storySummary: v.storySummary
    }
  })
  const contexts = fixture.videos.map((v) => ({
    words: v.transcript.segments.flatMap((s) => s.words),
    seconds: v.durationS,
    excluded: v.adRanges.ranges
  }))
  return evalStage(
    "set-story",
    setStoryTask({
      brief: fixture.brief,
      videos,
      readDirs: videos.filter((v) => v.sheets.length > 0).map((v) => v.sheetsDir),
      tools: transcriptTools(videos)
    }),
    (p) => checkSetStory(p, contexts)
  )
}
