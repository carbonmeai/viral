import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

export class JobsRpcs extends RpcGroup.make(
  // Answers a pending approval; returns false when no such request is waiting.
  Rpc.make("Respond", {
    payload: { requestId: Schema.String, approved: Schema.Boolean },
    success: Schema.Boolean
  }),
  // Cancels a running job from any connected client; returns false when the job is unknown.
  Rpc.make("CancelJob", {
    payload: { jobId: Schema.String },
    success: Schema.Boolean
  })
) {}
