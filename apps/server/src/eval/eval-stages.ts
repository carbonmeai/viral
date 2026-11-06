import { Effect, type Path, Schema } from "effect"
import { checkAds } from "../ads/ad-rules.ts"
import { adsTask } from "../ads/ads-task.ts"
import type { AgentError, AgentRoute, AgentSession } from "../agent-session/agent-session.ts"
import { type Checked, type CheckedTask, runChecked } from "../agent-session/run-checked.ts"
import { checkMetadata } from "../metadata/metadata-rules.ts"
import { metadataTask } from "../metadata/metadata-task.ts"
import type { StageContext } from "../runs/stages.ts"
import { checkScript, SCRIPT_LIMITS } from "../script/script-rules.ts"
import { scriptTask } from "../script/script-task.ts"
import { checkStory } from "../story/story-rules.ts"
import { storyTask } from "../story/story-task.ts"
import { timedText } from "../transcribe/transcripts.ts"
import type { EvalFixture } from "./eval-fixture.ts"

// The agent stages an eval can run: the text stages (shots and thumbnail need gateway vision, not built yet).
export const EvalStageName = Schema.Literals(["ads", "story", "script", "metadata"])
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

export const evalStages = (fixture: EvalFixture, fixtureDir: string, path: Path.Path): Record<EvalStageName, EvalStage> => {
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
      scriptTask(short.approach, { title: source.title, channel: source.channel, transcript, excluded, angle: short.angle }),
      (p) => {
        if (limits === undefined) return { value: p, problems: [`${short.approach} shorts have no narrated script`] }
        const checked = checkScript(p, limits, words, excluded)
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
        lines: short.script.beats.map((b) => b._tag === "Narration" ? `NARRATOR: ${b.text}` : `REAL: "${b.quote}"`).join("\n")
      }),
      checkMetadata
    )
  }
}
