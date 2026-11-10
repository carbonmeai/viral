import { NodeServices } from "@effect/platform-node"
import type { ChatEntry, ChatItem, ProjectId, RunOwner } from "@viral/contracts"
import { replayAnswer } from "@viral/provider-testing"
import { Duration, Effect, Layer, ManagedRuntime, Schema, Stream } from "effect"
import { SqlClient } from "effect/sql"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { AgentSession, type AgentTask } from "../agent-session/agent-session.ts"
import { runChecked } from "../agent-session/run-checked.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { MusicLibrary } from "../music-library/music-library.ts"
import { MusicBeds } from "../music-bed/music-beds.ts"
import { Presets } from "../presets/presets.ts"
import { Projects } from "../projects/projects.ts"
import { RunManager } from "../runs/run-manager.ts"
import { RunStore } from "../runs/run-store.ts"
import { type StageContext, type StageDefinition, StageRegistry } from "../runs/stages.ts"
import { Sources } from "../sources/sources.ts"
import { ElevenLabs } from "../voice/eleven-labs.ts"
import { DatabaseLive } from "../persistence/database.ts"
import { ShortChat } from "./chat-service.ts"
import { ChatStore } from "./chat-store.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-chat-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

// What the replayed agents were asked, and what the sections agent answers each time (the hook moves on a revision).
const asked: Array<AgentTask<Schema.Top>> = []
const intent: { answer: unknown } = { answer: null }
const sectionsAnswer = (n: number) => ({
  hookText: "She fit inside her hand",
  sections: [
    { beat: "hook", start: n === 1 ? 20 : 30, end: n === 1 ? 24 : 33, note: "the line" },
    { beat: "payoff", start: 40, end: 48, note: "the result" }
  ]
})
const replay = AgentSession.replay((task) => {
  asked.push(task)
  if (task.stage === "chat") return intent.answer
  const n = asked.filter((t) => t.stage === "sections").length
  return replayAnswer({ reply: n === 1 ? "I opened on her best line." : "Moved the hook later, as you asked.", result: sectionsAnswer(n) })
})

// A cut-down's stages, small: sections (an agent stage through runChecked, gated), assemble, render (gated, sent back to
// sections).
const fakeStages = Layer.effect(StageRegistry, Effect.gen(function*() {
  const artifacts = yield* Artifacts
  const agent = yield* AgentSession
  const record = (ctx: StageContext, kind: "cut-plan" | "cut-render-plan" | "render", data: unknown) =>
    Effect.gen(function*() {
      const slot = yield* artifacts.allocate(ctx.owner, kind)
      yield* artifacts.record(slot, { data, path: null, stageRunId: ctx.stageRunId })
    })
  const SectionsOut = Schema.Struct({
    hookText: Schema.NullOr(Schema.String),
    sections: Schema.Array(Schema.Struct({ beat: Schema.String, start: Schema.Finite, end: Schema.Finite, note: Schema.String }))
  })
  const sections: StageDefinition = {
    name: "sections",
    artifact: "cut-plan",
    gate: "Approve the sections?",
    run: (ctx) =>
      Effect.gen(function*() {
        const plan = yield* runChecked(agent, ctx, {
          stage: "sections",
          instructions: "pick sections",
          skills: [],
          brief: "the brief",
          output: { tool: "propose_sections", description: "the sections", schema: SectionsOut },
          defaultModel: null
        }, (p) => Effect.succeed({ value: p, problems: [] }))
        yield* record(ctx, "cut-plan", {
          hookText: plan.hookText,
          sections: plan.sections.map((s) => ({ ...s, source: 0, text: `words at ${s.start}`, frame: null })),
          storyboard: null
        })
      }).pipe(Effect.orDie)
  }
  const assemble: StageDefinition = { name: "assemble", artifact: "cut-render-plan", gate: null, run: (ctx) => record(ctx, "cut-render-plan", {}) }
  const render: StageDefinition = {
    name: "render",
    artifact: "render",
    gate: "Approve the render?",
    rejectTo: "sections",
    run: (ctx) => record(ctx, "render", { video: "short.mp4", captions: "short.srt", durationS: 11, shots: 2, checkSheet: null })
  }
  return StageRegistry.of({ stagesFor: () => Effect.succeed([sections, assemble, render]) })
}))

const runtime = () =>
  ManagedRuntime.make(
    ShortChat.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(ChatStore.layer, MusicBeds.layer)),
      Layer.provideMerge(RunManager.layer),
      Layer.provideMerge(fakeStages),
      Layer.provideMerge(Layer.mergeAll(
        RunStore.layer,
        Artifacts.layer,
        Sources.layer,
        Projects.layer,
        Presets.layer,
        MusicLibrary.layer,
        replay,
        ElevenLabs.replay(() => new Uint8Array()),
        NodeServices.layer
      ))
    )
  )
type Runtime = ReturnType<typeof runtime>

const createShort = (rt: Runtime) =>
  rt.runPromise(Effect.gen(function*() {
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "owned", rightsNote: null })
    yield* (yield* Sources).rename(source.id, "Heidi")
    const project = yield* (yield* Projects).create({ sourceIds: [source.id], title: "Cut", approach: "cut-down", presetId: null, musicTrackId: null })
    return project.id
  }))

// The thread from the start until an item matches (at most 10s).
const until = (rt: Runtime, projectId: ProjectId, stop: (items: ReadonlyArray<ChatEntry>) => boolean) =>
  rt.runPromise(Effect.gen(function*() {
    const chat = yield* ShortChat
    const seen: Array<ChatEntry> = []
    yield* chat.subscribe(projectId, 0).pipe(
      Stream.map((u) => u._tag === "Snapshot" ? u.items : [u.entry]),
      Stream.takeUntil((items) => {
        seen.push(...items)
        return stop(seen)
      }),
      Stream.runDrain,
      Effect.timeout(Duration.seconds(10))
    )
    return seen
  }))

const tags = (items: ReadonlyArray<ChatEntry>) => items.map((i) => i.item._tag)
const gateOpen = (stage: string) => (items: ReadonlyArray<ChatEntry>) =>
  items.at(-1)?.item._tag === "Gate" && (items.at(-1)!.item as Extract<ChatItem, { _tag: "Gate" }>).stage === stage
const agentMade = (items: ReadonlyArray<ChatEntry>) => items.filter((i) => i.item._tag === "AgentMade").map((i) => i.item as Extract<ChatItem, { _tag: "AgentMade" }>)
const pending = (rt: Runtime) => rt.runPromise(Effect.gen(function*() {
    const s = yield* RunStore
    return yield* s.listPendingRequests
  }))
const approve = (rt: Runtime) =>
  rt.runPromise(Effect.gen(function*() {
    const [request] = yield* (yield* RunStore).listPendingRequests
    return yield* (yield* RunManager).respond(request!.id, { _tag: "Approve" })
  }))
const send = (rt: Runtime, projectId: ProjectId, step: "sections" | "render" | "music", text: string, stopRun = false) =>
  rt.runPromise(Effect.gen(function*() {
    const chat = yield* ShortChat
    return yield* chat.send(projectId, step, text, stopRun)
  }))

test("a short's chat: the agent's words and checks, a note at the gate, a redo with a note, a busy run, the intent agent", async () => {
  const rt = runtime()
  const projectId = await createShort(rt)
  const owner: RunOwner = { _tag: "Project", id: projectId }
  await rt.runPromise(Effect.gen(function*() {
    const m = yield* RunManager
    return yield* m.start(owner, null)
  }))

  // the first version: the agent's own words (tell_creator), the server's checks, no change card, then the gate
  let items = await until(rt, projectId, gateOpen("sections"))
  assert.deepEqual(tags(items), ["AgentMade", "Gate"])
  const first = agentMade(items)[0]!
  assert.equal(first.reply, "I opened on her best line.")
  assert.equal(first.change, null)
  assert.ok(first.checks.some((c) => c.text === "The hook comes first"))
  assert.ok(asked[0]!.tools?.some((t) => t.name === "tell_creator"), "every agent turn is offered tell_creator")

  // a message at the gate is a rejection with the note; the agent continues its conversation and the card shows the change
  const atGate = await send(rt, projectId, "sections", "Start on a later line")
  assert.deepEqual(atGate.said.item._tag === "YouSaid" && atGate.said.item.action, { _tag: "Revise", stage: "sections" })
  items = await until(rt, projectId, (all) => all.filter((i) => i.item._tag === "Gate").length === 2)
  assert.deepEqual(tags(items), ["AgentMade", "Gate", "YouSaid", "AgentMade", "Gate"], "your words are written once")
  const revised = agentMade(items)[1]!
  assert.equal(revised.reply, "Moved the hook later, as you asked.")
  assert.match(revised.change?.lines[0]?.new ?? "", /Hook · Heidi 0:30–0:33/)
  assert.equal(asked.at(-1)!.resumeSession, "replay-sections")
  assert.match(asked.at(-1)!.message, /^Revise it: Start on a later line/)

  // while the run is busy elsewhere (the render waits), a message to sections offers "Stop and redo"
  await approve(rt)
  await until(rt, projectId, gateOpen("render"))
  const busy = await send(rt, projectId, "sections", "Shorter payoff")
  assert.deepEqual(busy.said.item._tag === "YouSaid" && busy.said.item.action, {
    _tag: "NotDone", reason: "The run is on Render. Stop it and redo from Sections?", offer: "sections", retry: null
  })

  // on a step without an agent, the intent agent's action runs: the render goes back to sections with its note
  intent.answer = { reply: "Sending it back so the payoff ends sooner.", action: { _tag: "SendBack", to: "sections", note: "End the payoff sooner" } }
  const toRender = await send(rt, projectId, "render", "the ending drags")
  assert.equal(toRender.said.item._tag === "YouSaid" && toRender.said.item.action._tag, "Action")
  assert.equal(toRender.replies[0]?.item._tag, "AgentSaid")
  assert.ok(asked.some((t) => t.stage === "chat" && t.defaultModel === "haiku"))
  items = await until(rt, projectId, (all) => all.filter((i) => i.item._tag === "Gate").length === 4)
  assert.match(asked.filter((t) => t.stage === "sections").at(-1)!.message, /End the payoff sooner/)
  assert.equal(items.filter((i) => i.item._tag === "YouSaid" && i.item.text === "the ending drags").length, 1)

  // an approved step and an idle run: a redo from it with the note, picking up the agent's last conversation
  await approve(rt)
  await until(rt, projectId, gateOpen("render"))
  await approve(rt)
  await rt.runPromise(Effect.sleep(Duration.millis(200)))
  assert.equal((await pending(rt)).length, 0)
  const redo = await send(rt, projectId, "sections", "Open on the hand instead")
  assert.deepEqual(redo.said.item._tag === "YouSaid" && redo.said.item.action, { _tag: "Redo", from: "sections" })
  await until(rt, projectId, (all) => all.filter((i) => i.item._tag === "Gate").length === 6)
  const last = asked.filter((t) => t.stage === "sections").at(-1)!
  assert.equal(last.resumeSession, "replay-sections")
  assert.match(last.message, /Open on the hand instead/)
  await rt.dispose()
})

test("an older short's thread is rebuilt once from its runs, then follows new ones", async () => {
  // a short made and finished before the chat: its items are gone, and the next server process rebuilds them
  const first = runtime()
  const projectId = await createShort(first)
  await first.runPromise(Effect.gen(function*() {
    const m = yield* RunManager
    return yield* m.start({ _tag: "Project", id: projectId }, null)
  }))
  await until(first, projectId, gateOpen("sections"))
  await approve(first)
  await until(first, projectId, gateOpen("render"))
  await approve(first)
  await first.runPromise(Effect.sleep(Duration.millis(200)))
  await first.dispose()
  await Effect.runPromise(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`DELETE FROM chat_items`
  }).pipe(Effect.provide(DatabaseLive)))

  const rt = runtime()
  const get = () => rt.runPromise(Effect.gen(function*() {
    const chat = yield* ShortChat
    return yield* chat.get(projectId)
  }))
  const thread = await get()
  assert.deepEqual(tags(thread.items), ["AgentMade", "Approved", "StepNote", "Approved", "Earlier"])
  const made = thread.items[0]!.item as Extract<ChatItem, { _tag: "AgentMade" }>
  assert.equal(made.earlier, true)
  assert.equal(made.change, null)
  assert.equal((await get()).items.length, 5, "rebuilt once")
  await rt.runPromise(Effect.gen(function*() {
    const m = yield* RunManager
    return yield* m.start({ _tag: "Project", id: projectId }, "render")
  }))
  const items = await until(rt, projectId, gateOpen("render"))
  assert.deepEqual(tags(items).slice(5), ["StepNote", "Gate"])
  await rt.dispose()
})

test("steps the run hasn't reached, and a cut-down's music, answer without acting", async () => {
  const rt = runtime()
  const projectId = await createShort(rt)
  await rt.runPromise(Effect.gen(function*() {
    const m = yield* RunManager
    return yield* m.start({ _tag: "Project", id: projectId }, null)
  }))
  await until(rt, projectId, gateOpen("sections"))
  intent.answer = { reply: "I'll send it back.", action: { _tag: "SendBack", to: "sections", note: "x" } }
  const early = await send(rt, projectId, "render", "too long")
  assert.deepEqual(early.said.item._tag === "YouSaid" && early.said.item.action, { _tag: "NotDone", reason: "Render opens when the run gets there.", offer: null, retry: null })
  intent.answer = { reply: "Moving the drop.", action: { _tag: "Refit", dropWord: 3 } }
  const music = await send(rt, projectId, "music", "drop on worked")
  assert.match(music.said.item._tag === "YouSaid" && music.said.item.action._tag === "NotDone" ? music.said.item.action.reason : "", /own sound/)
  assert.equal((await pending(rt)).length, 1, "the sections gate still waits")
  await rt.dispose()
})
