import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

// The command-line tools the pipeline runs. Viral downloads any that are missing on first run.
export const ToolName = Schema.Literals(["ffmpeg", "ffprobe", "uv", "yt-dlp"])
export type ToolName = typeof ToolName.Type

export const ToolStatus = Schema.Literals(["ready", "missing", "installing", "failed"])
export type ToolStatus = typeof ToolStatus.Type

// viral: Viral's own copy in its tools folder · system: one already on your PATH (e.g. Homebrew)
export const ToolSource = Schema.Literals(["viral", "system"])
export type ToolSource = typeof ToolSource.Type

export const Tool = Schema.Struct({
  name: ToolName,
  status: ToolStatus,
  source: Schema.NullOr(ToolSource),
  // the first line of the tool's own version output
  version: Schema.NullOr(Schema.String),
  path: Schema.NullOr(Schema.String),
  // why the last install failed
  error: Schema.NullOr(Schema.String)
})
export type Tool = typeof Tool.Type

// What installing the missing tools reports, one tool after another.
export const ToolProgress = Schema.Union([
  // total is null when the download doesn't say its size
  Schema.TaggedStruct("Downloading", { name: ToolName, bytes: Schema.Int, total: Schema.NullOr(Schema.Int) }),
  Schema.TaggedStruct("Installed", { tool: Tool }),
  Schema.TaggedStruct("Failed", { name: ToolName, message: Schema.String })
])
export type ToolProgress = typeof ToolProgress.Type

export class ToolsRpcs extends RpcGroup.make(
  // Each tool's state, looked up again on every call (a tool installed meanwhile shows up).
  Rpc.make("ListTools", { success: Schema.Array(Tool) }),
  // Downloads every missing tool into Viral's tools folder, reporting progress; tools already present are left alone.
  Rpc.make("InstallTools", { success: ToolProgress, stream: true })
) {}
