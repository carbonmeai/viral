import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { Script } from "./script.ts"

export const JobEvent = Schema.Union([
  Schema.TaggedStruct("StageStarted", { stage: Schema.String }),
  Schema.TaggedStruct("StageSkipped", { stage: Schema.String, reason: Schema.String }),
  Schema.TaggedStruct("Log", { stage: Schema.String, message: Schema.String }),
  Schema.TaggedStruct("AgentText", { text: Schema.String }),
  Schema.TaggedStruct("ToolCalled", { name: Schema.String }),
  Schema.TaggedStruct("ScriptProposed", { script: Script }),
  Schema.TaggedStruct("ApprovalRequested", { requestId: Schema.String, title: Schema.String }),
  Schema.TaggedStruct("Progress", { stage: Schema.String, pct: Schema.Number }),
  Schema.TaggedStruct("Completed", { output: Schema.String }),
  Schema.TaggedStruct("Rejected", {}),
  Schema.TaggedStruct("Cancelled", {}),
  Schema.TaggedStruct("Failed", { message: Schema.String })
])
export type JobEvent = typeof JobEvent.Type

export class PipelineRpcs extends RpcGroup.make(
  // Runs the pipeline (script agent -> approval -> render) and streams its events.
  Rpc.make("StartJob", {
    payload: { jobId: Schema.String, renderSeconds: Schema.Number },
    success: JobEvent,
    stream: true
  })
) {}
