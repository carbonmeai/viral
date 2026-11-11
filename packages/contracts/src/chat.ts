import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { ProjectId, ProjectNotFound } from "./projects.ts"
import { RequestId, Run, RunId, StageName, StageRunId } from "./runs.ts"

export const ChatItemId = Schema.String.pipe(Schema.brand("ChatItemId"))
export type ChatItemId = typeof ChatItemId.Type

// The editor's steps a message can be about. `music` and `style` have no stage of their own (the music is fitted and
// the style applied in assemble); `publish` is the metadata stage.
export const ChatStep = Schema.Literals([
  "script",
  "sections",
  "moments",
  "voice",
  "shots",
  "music",
  "render",
  "publish",
  "thumbnail",
  "style"
])
export type ChatStep = typeof ChatStep.Type

// One line of a change card: the old version struck through, the new one highlighted (either may be absent: a line
// added or removed), or a note ("Still 131.9s").
export const ChangeLine = Schema.Struct({
  label: Schema.String,
  old: Schema.NullOr(Schema.String),
  new: Schema.NullOr(Schema.String),
  note: Schema.NullOr(Schema.String)
})
export type ChangeLine = typeof ChangeLine.Type

// What changed between the version you asked about and the new one, worked out by the server from the two versions,
// so it is right even when the agent's words aren't.
export const Change = Schema.Struct({
  headline: Schema.String,
  lines: Schema.Array(ChangeLine)
})
export type Change = typeof Change.Type

// A rule the server checked the result against, in plain words.
// `at`: the moment of the short a check is about (the render's read-back), so the chat can seek there
export const ChatCheck = Schema.Struct({ text: Schema.String, ok: Schema.Boolean, at: Schema.optionalKey(Schema.Finite) })
export type ChatCheck = typeof ChatCheck.Type

// A step without its own agent (voice, music, render, style) answers through these existing actions: from the small
// intent agent (your words) or a suggestion chip.
export const ChatIntentAction = Schema.Union([
  // use this voice for the short's narration (a new take is made)
  Schema.TaggedStruct("SetVoice", { voiceId: Schema.String }),
  // speak the narration again with the same voice
  Schema.TaggedStruct("NewTake", {}),
  // the song (absent: keep it; null: no music, voice only) and/or the narration word the drop lands on (absent: keep
  // it; null: the automatic one); the bed is fitted again
  Schema.TaggedStruct("Refit", {
    trackId: Schema.optionalKey(Schema.NullOr(Schema.String)),
    dropWord: Schema.optionalKey(Schema.NullOr(Schema.Int))
  }),
  // the music's arrangement back to automatic
  Schema.TaggedStruct("AutoArrangement", {}),
  // the short's style; it re-renders with no agent cost
  Schema.TaggedStruct("SetStyle", { presetId: Schema.String }),
  // the render goes back to an earlier step with a note for its agent ("assemble" = the style and layout)
  Schema.TaggedStruct("SendBack", { to: Schema.Literals(["shots", "sections", "moments", "assemble"]), note: Schema.String }),
  // none of the above fits
  Schema.TaggedStruct("CantDo", {})
])
export type ChatIntentAction = typeof ChatIntentAction.Type

// What the server did with a message.
export const ChatAction = Schema.Union([
  // the step was waiting: your words went to its agent as a rejection with this note
  Schema.TaggedStruct("Revise", { stage: StageName }),
  // the step was approved: the short runs again from it with your note
  Schema.TaggedStruct("Redo", { from: StageName }),
  // an existing action ran (a step without an agent): what it did, in plain words
  Schema.TaggedStruct("Action", { kind: Schema.String, summary: Schema.String }),
  // nothing happened, and why; `offer`: stop the run that's going and redo from this stage instead (`retry`: the
  // action the intent agent chose, run as it is when you say yes, so it isn't asked again)
  Schema.TaggedStruct("NotDone", { reason: Schema.String, offer: Schema.NullOr(StageName), retry: Schema.NullOr(ChatIntentAction) })
])
export type ChatAction = typeof ChatAction.Type

const Billing = Schema.NullOr(Schema.Literals(["billed", "subscription"]))

// One item of a short's conversation.
export const ChatItem = Schema.Union([
  // your message, and what the server did with it
  Schema.TaggedStruct("YouSaid", { step: ChatStep, text: Schema.String, action: ChatAction }),
  // an agent step's new version: the agent's own words (null when it didn't say), the server's line about it, the
  // change against the version before (null for a first version), and what the server checked
  Schema.TaggedStruct("AgentMade", {
    stage: StageName,
    version: Schema.NullOr(Schema.Int),
    reply: Schema.NullOr(Schema.String),
    summary: Schema.String,
    change: Schema.NullOr(Change),
    checks: Schema.Array(ChatCheck),
    attempt: Schema.Int,
    model: Schema.NullOr(Schema.String),
    provider: Schema.NullOr(Schema.String),
    billing: Billing,
    costUsd: Schema.NullOr(Schema.Finite),
    // rebuilt from an older short's runs: no change card
    earlier: Schema.Boolean
  }),
  // a step without an agent finished: "The voice take is ready: Adam, 41.0s"
  Schema.TaggedStruct("StepNote", {
    stage: StageName,
    text: Schema.String,
    change: Schema.NullOr(Change),
    checks: Schema.Array(ChatCheck),
    earlier: Schema.Boolean
  }),
  // the intent agent's answer on a step without an agent of its own
  Schema.TaggedStruct("AgentSaid", {
    step: ChatStep,
    text: Schema.String,
    model: Schema.NullOr(Schema.String),
    provider: Schema.NullOr(Schema.String),
    billing: Billing,
    costUsd: Schema.NullOr(Schema.Finite)
  }),
  // a gate: whether it is still open is read from its request (the row's requestId)
  Schema.TaggedStruct("Gate", { stage: StageName, title: Schema.String }),
  // you approved a step, as it was or with your own edit
  Schema.TaggedStruct("Approved", { stage: StageName, how: Schema.Literals(["approve", "edit"]) }),
  Schema.TaggedStruct("Failed", { stage: Schema.NullOr(StageName), message: Schema.String }),
  // where an older short's rebuilt history ends
  Schema.TaggedStruct("Earlier", { text: Schema.String })
])
export type ChatItem = typeof ChatItem.Type

export const ChatRole = Schema.Literals(["you", "agent", "app"])
export type ChatRole = typeof ChatRole.Type

export const ChatEntry = Schema.Struct({
  id: ChatItemId,
  seq: Schema.Int,
  role: ChatRole,
  stage: Schema.NullOr(StageName),
  runId: Schema.NullOr(RunId),
  stageRunId: Schema.NullOr(StageRunId),
  requestId: Schema.NullOr(RequestId),
  item: ChatItem,
  createdAt: Schema.DateTimeUtcFromString
})
export type ChatEntry = typeof ChatEntry.Type

export const ChatThread = Schema.Struct({ items: Schema.Array(ChatEntry), lastSeq: Schema.Int })
export type ChatThread = typeof ChatThread.Type

// What a SubscribeChat stream sends: the thread so far, then each new item as it's written.
export const ChatUpdate = Schema.Union([
  Schema.TaggedStruct("Snapshot", { items: Schema.Array(ChatEntry), lastSeq: Schema.Int }),
  Schema.TaggedStruct("Item", { entry: ChatEntry })
])
export type ChatUpdate = typeof ChatUpdate.Type

// What sending a message did: your item (with its resolved action), any reply written with it, and the run it
// started or answered.
export const ChatSent = Schema.Struct({
  said: ChatEntry,
  replies: Schema.Array(ChatEntry),
  run: Schema.NullOr(Run)
})
export type ChatSent = typeof ChatSent.Type

// The message couldn't be handled (the intent agent failed, a voice or song that doesn't exist).
export class ChatFailed extends Schema.TaggedError<ChatFailed>()("ChatFailed", { message: Schema.String }) {}

export class ChatRpcs extends RpcGroup.make(
  // A short's conversation; an older short's is rebuilt once from its runs.
  Rpc.make("GetChat", { payload: { projectId: ProjectId }, success: ChatThread, error: ProjectNotFound }),
  Rpc.make("SubscribeChat", {
    payload: { projectId: ProjectId, afterSeq: Schema.Int },
    success: ChatUpdate,
    error: ProjectNotFound,
    stream: true
  }),
  // A message about one step. Every message is a change request: at the step's gate it's a rejection with your note;
  // on an approved agent step the short runs again from it with the note; on a step without an agent the intent agent
  // turns it into an existing action. While the run is busy elsewhere nothing happens unless `stopRun` (the
  // "Stop and redo" answer).
  Rpc.make("SendChat", {
    payload: { projectId: ProjectId, step: ChatStep, text: Schema.String, stopRun: Schema.optionalKey(Schema.Boolean) },
    success: ChatSent,
    error: Schema.Union([ProjectNotFound, ChatFailed])
  }),
  // A suggestion chip's own action, recorded in the conversation with its label.
  Rpc.make("DoChatAction", {
    payload: {
      projectId: ProjectId,
      step: ChatStep,
      label: Schema.String,
      action: ChatIntentAction,
      stopRun: Schema.optionalKey(Schema.Boolean)
    },
    success: ChatSent,
    error: Schema.Union([ProjectNotFound, ChatFailed])
  })
) {}
