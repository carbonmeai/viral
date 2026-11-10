import type { AgentStage, AppSettings, ChatEntry, ChatIntentAction, ChatItem, ChatStep, ChatUpdate, ProjectFormat, RunRequest, StageName } from "@viral/contracts"
import { resolveAgentRoute } from "@viral/contracts"
import type { EditorStepId, EditorStepState } from "../editor-values.ts"

// The thread as the column shows it.
export interface ChatThreadState {
  readonly items: ReadonlyArray<ChatEntry>
  readonly lastSeq: number
  readonly loaded: boolean
}
export const emptyThread: ChatThreadState = { items: [], lastSeq: 0, loaded: false }

// Folds a SubscribeChat stream: the snapshot, then each new item once (a reconnect's snapshot replaces the list).
export const foldChat = (state: ChatThreadState, update: ChatUpdate): ChatThreadState => {
  if (update._tag === "Snapshot") return { items: update.items, lastSeq: update.lastSeq, loaded: true }
  if (update.entry.seq <= state.lastSeq) return state
  return { items: [...state.items, update.entry], lastSeq: update.entry.seq, loaded: true }
}

// The step a message about an editor step is about (the editor's steps are the chat's).
export const chatStepOf = (step: EditorStepId): ChatStep => step

// Steps whose own agent answers a message; the others go through the small intent agent.
const AGENT_STEPS: Partial<Record<ChatStep, AgentStage>> = {
  script: "script",
  sections: "sections",
  moments: "moments",
  shots: "shots",
  publish: "metadata",
  thumbnail: "thumbnail"
}
export const agentStageOf = (step: ChatStep): AgentStage | null => AGENT_STEPS[step] ?? null

export const STEP_NAMES: Record<ChatStep, string> = {
  script: "Script",
  sections: "Sections",
  moments: "Ranking",
  voice: "Voice",
  shots: "Shots",
  music: "Music",
  render: "Render",
  publish: "Post",
  thumbnail: "Thumbnail",
  style: "Style"
}
const STAGE_STEP: Partial<Record<StageName, ChatStep>> = {
  script: "script",
  sections: "sections",
  moments: "moments",
  voice: "voice",
  shots: "shots",
  assemble: "music",
  render: "render",
  metadata: "publish",
  thumbnail: "thumbnail"
}
export const stageName = (stage: StageName | null) => stage === null ? "Short" : STEP_NAMES[STAGE_STEP[stage] ?? "script"]

const PROVIDERS: Record<string, string> = {
  "claude-cli": "Claude CLI",
  codex: "Codex",
  opencode: "OpenCode",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Gemini",
  openrouter: "OpenRouter",
  "ai-gateway": "AI Gateway",
  replay: "Replay"
}
export const providerName = (provider: string | null) => provider === null ? null : PROVIDERS[provider] ?? provider

// "claude-haiku-5-5" → "Haiku 5.5", "haiku" → "Haiku", "anthropic/claude-sonnet-5" → "Sonnet 5"
export const shortModel = (model: string | null) => {
  if (model === null) return null
  const base = model.split("/").at(-1)!.replace(/^claude-/, "").replace(/-\d{8}$/, "")
  const [family, ...version] = base.split("-")
  if (family === undefined) return model
  const name = family[0]!.toUpperCase() + family.slice(1)
  return version.length === 0 ? name : `${name} ${version.join(".")}`
}

// "$0.004", "$0.03"
export const costText = (usd: number | null) =>
  usd === null || usd === 0 ? null : usd < 0.01 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`

// Who answers a message on a step, for the composer's footer: the step's agent on its route (Settings › Agents), or
// the small intent agent on Haiku for steps without an agent of their own.
export const whoAnswers = (step: ChatStep, settings: AppSettings | null) => {
  const stage = agentStageOf(step)
  if (stage === null) return { who: "Agent", how: "Claude CLI · Haiku", billing: "about $0.01 a reply, on your plan" }
  const route = settings === null
    ? { provider: "claude-cli" as const, model: null }
    : resolveAgentRoute(stage, settings.defaultAgent, settings.stageAgents[stage], settings.visionModels)
  const plan = route.provider === "claude-cli" || route.provider === "codex"
  return {
    who: `${STEP_NAMES[step]} agent`,
    how: [providerName(route.provider), shortModel(route.model)].filter((p) => p !== null).join(" · "),
    billing: plan ? "on your plan" : "billed per reply"
  }
}

// What the composer can do on the open step: an agent step takes notes at its gate or once it's done; before the run
// gets there it waits. Steps without an agent always take a message (the server says when it can't act yet).
export const composerState = (
  step: ChatStep,
  state: EditorStepState | undefined,
  // the gate waiting now is this step's
  waitingHere = false
): { readonly enabled: boolean; readonly why: string | null } => {
  if (agentStageOf(step) === null || waitingHere) return { enabled: true, why: null }
  if (state === "waiting" || state === "done") return { enabled: true, why: null }
  if (state === "running") return { enabled: false, why: `The ${STEP_NAMES[step].toLowerCase()} agent is working on it.` }
  return { enabled: false, why: "Opens when the run gets here." }
}

// A suggestion chip: words sent to the step's agent, an existing action run as it is, or a panel opened.
export type Chip =
  | { readonly label: string; readonly send: string }
  | { readonly label: string; readonly act: ChatIntentAction }
  | { readonly label: string; readonly open: "music-picker" | "style" }

export interface ChipContext {
  readonly format: ProjectFormat
  // the videos' short names, V1 first
  readonly videos: ReadonlyArray<string>
  // another of your voices to try (not the short's own)
  readonly otherVoice: { readonly id: string; readonly name: string } | null
  readonly hasSong: boolean
  // a ranking's entries (a swap chip needs three to swap #2 and #3)
  readonly entries: number
}

// The chips for a step, typed: what each does is decided here, not by the agent.
export const chipsFor = (step: ChatStep, ctx: ChipContext): ReadonlyArray<Chip> => {
  const second = ctx.videos[1]
  const more = second === undefined ? [] : [{ label: `Use more of ${second}`, send: `Use more of ${second}'s clip.` }]
  const backTo = ctx.format === "cut-down" ? "sections" as const : ctx.format === "ranking" ? "moments" as const : "shots" as const
  const backName = { shots: "the shots", sections: "the sections", moments: "the ranking" }[backTo]
  switch (step) {
    case "script":
      return [
        { label: "Make the hook punchier", send: "Make the hook punchier." },
        ...more,
        ...(ctx.format === "narrated" ? [{ label: "Swap the music", open: "music-picker" as const }] : []),
        { label: "Shorter, under 40s", send: "Make it shorter, under 40 seconds." }
      ]
    case "sections":
      return [{ label: "Make the hook punchier", send: "Open on a punchier hook." }, ...more, { label: "Shorter, under 40s", send: "Make it shorter, under 40 seconds." }]
    case "moments":
      return [
        ctx.entries >= 3 ? { label: "Swap #2 and #3", send: "Swap #2 and #3." } : { label: "Swap #1 and #2", send: "Swap #1 and #2." },
        { label: "Shorter titles", send: "Make the titles shorter." },
        { label: "Under 60 seconds", send: "Bring the whole ranking under 60 seconds." }
      ]
    case "voice":
      return [
        { label: "Another take", act: { _tag: "NewTake" } },
        ...(ctx.otherVoice === null ? [] : [{ label: `Try ${ctx.otherVoice.name}'s voice`, act: { _tag: "SetVoice", voiceId: ctx.otherVoice.id } as const }])
      ]
    case "shots":
      return [...more, { label: "More variety", send: "Use more different moments; fewer repeats of the same scene." }]
    case "music":
      return ctx.format !== "narrated"
        ? []
        : [
          { label: "Swap the music", open: "music-picker" },
          ...(ctx.hasSong ? [{ label: "No music", act: { _tag: "Refit", trackId: null } as const }, { label: "Automatic arrangement", act: { _tag: "AutoArrangement" } as const }] : [])
        ]
    case "render":
      return [
        { label: `Send back to ${backName}`, act: { _tag: "SendBack", to: backTo, note: "Look at the render again and fix what plays badly." } },
        { label: "Change the style", open: "style" }
      ]
    case "publish":
      return [{ label: "A punchier title", send: "Give it a punchier title." }, { label: "Fewer hashtags", send: "Use fewer hashtags." }]
    case "thumbnail":
      return [
        { label: "Bigger words", send: "Make the words bigger and fewer." },
        { label: "Stronger reactions", send: "Use the most extreme real reactions." },
        ...(second === undefined ? [] : [{ label: `Use ${second} as the face`, send: `Use ${second} for the face.` }])
      ]
    case "style":
      return []
  }
}

// How a gate item reads now: still open (its request is the one pending), approved (the approval line says so), or
// answered with a note (the new draft follows).
export const gateState = (entry: ChatEntry, items: ReadonlyArray<ChatEntry>, pending: RunRequest | null): "open" | "approved" | "replaced" | "closed" => {
  if (entry.requestId !== null && pending?.id === entry.requestId) return "open"
  const answers = items.filter((i) => i.requestId !== null && i.requestId === entry.requestId && i.seq > entry.seq)
  if (answers.some((i) => i.item._tag === "Approved")) return "approved"
  if (answers.some((i) => i.item._tag === "YouSaid")) return "replaced"
  return "closed"
}

// What the column shows after the items while the run works on an agent step: a skeleton reply from that step's agent.
export const workingOn = (running: boolean, current: EditorStepId, states: ReadonlyMap<EditorStepId, EditorStepState>): ChatStep | null =>
  running && states.get(current) === "running" ? current : null

// The words of an item for "Copy the conversation".
export const plainText = (item: ChatItem): string => {
  switch (item._tag) {
    case "YouSaid":
      return `You: ${item.text}`
    case "AgentMade":
      return `${stageName(item.stage)} agent: ${item.reply ?? item.summary}${item.change === null ? "" : `\n  ${item.change.headline}`}`
    case "StepNote":
      return `${stageName(item.stage)}: ${item.text}`
    case "AgentSaid":
      return `Agent: ${item.text}`
    case "Gate":
      return `Waiting for you · ${stageName(item.stage)}`
    case "Approved":
      return `You approved the ${stageName(item.stage).toLowerCase()}`
    case "Failed":
      return `Stopped: ${item.message}`
    case "Earlier":
      return `— ${item.text} —`
  }
}
