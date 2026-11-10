import { type ChatEntry, ChatStep, ProjectId } from "@viral/contracts"
import { Console, Effect, Schema } from "effect"
import { flag, positionals } from "./args.ts"
import { Client } from "./client.ts"

export const CHAT_USAGE = `  chat show <project-id>                  (the short's conversation: your messages, the agents' replies and changes)
  chat send <project-id> <step> "<text>" [--stop]
                                          (a change request about a step: script, sections, moments, voice, shots, music,
                                          render, publish, thumbnail, style; at its gate it's a rejection with your note,
                                          on an approved step it redoes the short from there, on voice/music/render/style
                                          a small agent turns it into an action; --stop stops a run that's busy elsewhere)`

const money = (usd: number | null) => usd === null ? "" : ` · $${usd.toFixed(usd < 0.01 ? 4 : 3)}`

// One item as a few plain lines.
export const chatLines = (entry: ChatEntry): ReadonlyArray<string> => {
  const item = entry.item
  switch (item._tag) {
    case "YouSaid": {
      const did = item.action._tag === "Revise"
        ? "sent to the agent at its gate"
        : item.action._tag === "Redo"
        ? `redoing from ${item.action.from}`
        : item.action._tag === "Action"
        ? item.action.summary
        : `not done: ${item.action.reason}`
      return [`you (${item.step}): ${item.text}`, `  → ${did}`]
    }
    case "AgentMade":
      return [
        `${item.stage} agent · ${item.provider ?? "?"} ${item.model ?? ""}${money(item.costUsd)}${item.earlier ? " (earlier)" : ""}`,
        `  ${item.reply ?? item.summary}`,
        ...(item.change === null ? [] : [`  ${item.change.headline}`, ...item.change.lines.map((l) =>
          l.note !== null ? `    ${l.label === "" ? "" : `${l.label}: `}${l.note}` : `    ${l.label}: ${l.old === null ? "" : `[-${l.old}-] `}${l.new === null ? "" : `{+${l.new}+}`}`
        )]),
        ...item.checks.map((c) => `  ${c.ok ? "✓" : "✗"} ${c.text}`)
      ]
    case "StepNote":
      return [
        `${item.stage}: ${item.text}`,
        ...(item.change === null ? [] : [`  ${item.change.headline}`, ...item.change.lines.map((l) => `    ${l.label}: ${l.old ?? ""} → ${l.new ?? l.note ?? ""}`)]),
        ...item.checks.map((c) => `  ${c.ok ? "✓" : "✗"} ${c.text}`)
      ]
    case "AgentSaid":
      return [`agent (${item.step}) · ${item.model ?? ""}${money(item.costUsd)}: ${item.text}`]
    case "Gate":
      return [`waiting for you · ${item.stage} (${entry.requestId ?? ""})`]
    case "Approved":
      return [`you approved the ${item.stage}${item.how === "edit" ? " with your edit" : ""}`]
    case "Failed":
      return [`failed${item.stage === null ? "" : ` at ${item.stage}`}: ${item.message}`]
    case "Earlier":
      return [`— ${item.text} —`]
  }
}

export const chatCommand = Effect.fn("chatCommand")(function*() {
  const client = yield* Client
  const [, sub, id, step, text] = positionals
  if (id === undefined) return yield* Console.error(CHAT_USAGE)
  const projectId = ProjectId.make(id)
  switch (sub) {
    case "show": {
      const thread = yield* client.GetChat({ projectId })
      if (thread.items.length === 0) return yield* Console.log("no messages yet")
      return yield* Effect.forEach(thread.items.flatMap(chatLines), (l) => Console.log(l), { discard: true })
    }
    case "send": {
      if (step === undefined || text === undefined) return yield* Console.error(CHAT_USAGE)
      const chatStep = yield* Schema.decodeUnknownEffect(ChatStep)(step)
      const sent = yield* client.SendChat({ projectId, step: chatStep, text, ...(flag("--stop") ? { stopRun: true } : {}) })
      yield* Effect.forEach([sent.said, ...sent.replies].flatMap(chatLines), (l) => Console.log(l), { discard: true })
      if (sent.run !== null) yield* Console.log(`run ${sent.run.id}  ${sent.run.status}  (follow it with \`follow ${sent.run.id}\`)`)
      return
    }
    default:
      return yield* Console.error(CHAT_USAGE)
  }
})
