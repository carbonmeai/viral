import type { AgentTask as ProviderTask } from "@viral/provider-core"
import type { Schema } from "effect"
import type { SkillName } from "../agent-skills/skill-pack.ts"

export {
  type AgentCost,
  AgentError,
  type AgentHooks,
  AgentProviderName,
  type AgentRoute,
  type AgentRun,
  type AgentTool,
  agentTool,
  type ToolAnswer,
  toolAnswer,
  toolJsonSchema,
  toolShape
} from "@viral/provider-core"

// An agent job whose skills are the app's skill pack.
export type AgentTask<S extends Schema.Top> = ProviderTask<S, SkillName>
