import { type ApproachName, ProposedScript } from "@viral/contracts"
import { approachSkill } from "../agent-skills/skill-pack.ts"
import type { CheckedTask } from "../agent-session/run-checked.ts"
import { buildScriptPrompt, SCRIPT_WRITER_PROMPT, type ScriptBrief } from "./script-prompt.ts"

// The script stage's agent task for a short of `approach`, shared by the stage and the evals.
export const scriptTask = (approach: ApproachName, brief: ScriptBrief): CheckedTask<typeof ProposedScript> => ({
  stage: "script",
  instructions: SCRIPT_WRITER_PROMPT,
  skills: ["story-arc", approachSkill(approach)],
  brief: buildScriptPrompt(brief),
  output: { tool: "propose_script", description: "Submit the whole script for review.", schema: ProposedScript },
  defaultModel: null,
  maxTurns: 4
})
