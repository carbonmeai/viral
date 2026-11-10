import { ChatIntentAction, type ChatStep } from "@viral/contracts"
import { Effect, Schema } from "effect"
import type { AgentSession } from "../agent-session/agent-session.ts"
import type { AgentCost } from "../agent-session/agent-task.ts"

// What the intent agent knows about the short when it reads your message.
export interface IntentContext {
  readonly step: ChatStep
  readonly text: string
  readonly format: "narrated" | "cut-down" | "ranking"
  readonly voices: ReadonlyArray<{ readonly id: string; readonly name: string; readonly current: boolean }>
  readonly songs: ReadonlyArray<{ readonly id: string; readonly title: string; readonly fittable: boolean; readonly current: boolean }>
  // the narration's words in order (their index is what a drop word is), and the word the drop lands on now
  readonly words: ReadonlyArray<string>
  readonly dropWord: number | null
  readonly styles: ReadonlyArray<{ readonly id: string; readonly name: string; readonly current: boolean }>
}

// The intent agent's answer: one action and a sentence or two for you.
export const IntentAnswer = Schema.Struct({
  reply: Schema.String,
  action: ChatIntentAction
})
export type IntentAnswer = typeof IntentAnswer.Type

const SEND_BACK: Record<IntentContext["format"], string> = {
  narrated: `"shots" (which footage plays, framing) or "assemble" (the style: captions, layout, music levels)`,
  "cut-down": `"sections" (which parts of the videos play) or "assemble" (the style)`,
  ranking: `"moments" (the entries, their order, titles and moments) or "assemble" (the style)`
}

export const INTENT_INSTRUCTIONS = `You turn a creator's message about one step of their short into exactly one of Viral's existing actions.
The step has no agent of its own (voice, music, render or style), so you never make anything yourself: you pick the action
the app should run, and say in one or two plain sentences what will happen. Call propose_action once.

Actions:
- SetVoice { voiceId }: narrate with another of the listed voices (a new take is made).
- NewTake {}: speak the narration again with the same voice (to fix a word, a different read).
- Refit { trackId?, dropWord? }: change the song (a listed song's id; null = no music, voice only; leave it out to keep
  the song) and/or the narration word the drop lands on (its index in the word list; null = automatic; leave it out to
  keep it). Only songs marked fittable can be used.
- AutoArrangement {}: put the music's arrangement back to automatic.
- SetStyle { presetId }: use another of the listed styles (captions, colours, layout). It re-renders, no agent cost.
- SendBack { to, note }: send the short back to an earlier step with a note for its agent, written for that agent.
- CantDo {}: when the message asks for something none of these do (or is unclear). Say what you can do instead.

Only use ids from the lists. Never invent a voice, song or style. Match a word the creator quotes to its index in the
word list (the first time it appears unless they say otherwise). Write the reply to the creator directly, without ids
or jargon.`

// The message the intent agent gets: the step, your words and what it can choose from.
export const intentMessage = (ctx: IntentContext) => {
  const list = <A extends { readonly current: boolean }>(items: ReadonlyArray<A>, line: (a: A) => string) =>
    items.length === 0 ? "  (none)" : items.map((i) => `  - ${line(i)}${i.current ? " (current)" : ""}`).join("\n")
  const words = ctx.words.slice(0, 400).map((w, i) => `${i}:${w}`).join(" ")
  return [
    `Step: ${ctx.step}. The short is ${ctx.format === "narrated" ? "narrated" : ctx.format === "cut-down" ? "a cut-down" : "a ranking"}.`,
    `Message: ${ctx.text}`,
    "",
    "Voices:",
    list(ctx.voices, (v) => `${v.name} [${v.id}]`),
    "Songs:",
    list(ctx.songs, (s) => `${s.title} [${s.id}]${s.fittable ? "" : " (not fittable: tempo or drop unknown)"}`),
    `Narration words (index:word): ${words === "" ? "(no voiceover yet)" : words}`,
    `The drop lands on word ${ctx.dropWord ?? "(automatic)"}.`,
    "Styles:",
    list(ctx.styles, (s) => `${s.name} [${s.id}]`),
    `Send back to: ${SEND_BACK[ctx.format]}.`
  ].join("\n")
}

// Runs the intent agent once, with no session: Haiku on the Claude CLI (the task's stage "chat" isn't a step of
// Settings › Agents). Its cost comes back with the answer, and each call's cost goes to `record` as it's billed (Usage).
export const runIntent = Effect.fn("runIntent")(function*(
  agent: AgentSession["Service"],
  ctx: IntentContext,
  record: (cost: AgentCost) => Effect.Effect<void> = () => Effect.void
) {
  const costs: Array<AgentCost> = []
  const answer = yield* agent.run({
    stage: "chat",
    instructions: INTENT_INSTRUCTIONS,
    skills: [],
    message: intentMessage(ctx),
    output: { tool: "propose_action", description: "The one action to run, and your reply to the creator.", schema: IntentAnswer },
    defaultModel: "haiku",
    maxTurns: 4
  }, {
    progress: () => Effect.void,
    recordCost: (cost) => Effect.sync(() => void costs.push(cost)).pipe(Effect.andThen(record(cost))),
    recordSession: () => Effect.void
  })
  const cost = costs.at(-1) ?? null
  return {
    answer,
    model: cost?.model ?? "haiku",
    provider: cost?.provider ?? null,
    billing: cost?.billing ?? null,
    costUsd: costs.reduce((t, c) => t + (c.costUsd ?? 0), 0)
  }
})
