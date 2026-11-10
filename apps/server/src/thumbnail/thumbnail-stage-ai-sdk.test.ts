import { NodeServices } from "@effect/platform-node"
import type { RunUpdate } from "@viral/contracts"
import { MockLanguageModelV4 } from "ai/test"
import { Effect, Layer, ManagedRuntime, Option, Stream } from "effect"
import { SecureRandom } from "effect/crypto"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { AgentSession } from "../agent-session/agent-session.ts"
import { SkillPack } from "../agent-skills/skill-pack.ts"
import { Artifacts } from "../artifacts/artifacts.ts"
import { CliSetups } from "../cli-setup/cli-setup.ts"
import { ViralHome } from "../home/viral-home.ts"
import { Projects } from "../projects/projects.ts"
import { PipelineStagesLive } from "../runs/pipeline-stages.ts"
import { RunManager } from "../runs/run-manager.ts"
import { RunStore } from "../runs/run-store.ts"
import { Secrets } from "../secrets/secrets.ts"
import { writeFakeSecurity } from "../secrets/testing/fake-security.ts"
import { AppSettingsStore } from "../settings/app-settings.ts"
import { Settings } from "../settings/settings.ts"
import { Sources } from "../sources/sources.ts"
import { Transcriber } from "../transcribe/transcriber.ts"
import { ElevenLabs } from "../voice/eleven-labs.ts"

// A vision stage end to end on an AI SDK provider: the thumbnail step set to a Gateway model that sees images, the
// real AgentSession and stage, and a scripted model that previews its draft, then submits. The draft the preview
// tool drew must come back to the model as an image (not a path it can't open), with the cost recorded as billed.

let dir: string
before(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "viral-thumbnail-ai-sdk-")))
  process.env.VIRAL_HOME = join(dir, "home")
  process.env.VIRAL_CUTOUT = "off"
  // a stand-in key: the model below is a mock, nothing is sent anywhere
  process.env.AI_GATEWAY_API_KEY = "test-gateway-key-0001"
})
after(() => rmSync(dir, { recursive: true, force: true }))

const good = {
  background: { src: 10 },
  hero: { src: 12, crop: [0.1, 0.1, 0.9, 0.9], circle: { x: 0.5, y: 0.5, r: 0.3 } },
  face: { src: 20, crop: [0.3, 0, 0.8, 1] },
  lines: [{ text: "7 tastes", color: "yellow" }, { text: "1 candy", color: "white" }]
}

type CallOptions = Parameters<MockLanguageModelV4["doGenerate"]>[0]
const calls: Array<CallOptions> = []
const usage = { inputTokens: { total: 3000, noCache: 3000, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 100, text: 100, reasoning: undefined } }
const step = (id: string, toolName: string) => ({
  content: [{ type: "tool-call" as const, toolCallId: id, toolName, input: JSON.stringify(good) }],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage,
  providerMetadata: { gateway: { cost: "0.001" } },
  warnings: []
})
const model = new MockLanguageModelV4({
  doGenerate: async (options) => {
    calls.push(options)
    return calls.length === 1 ? step("c1", "preview_thumbnail") : step("c2", "propose_thumbnail")
  }
})

const runtime = () => {
  const base = Layer.mergeAll(
    NodeServices.layer,
    SkillPack.layer,
    Settings.layer,
    Secrets.layerWith({ security: writeFakeSecurity(dir) }),
    ViralHome.layer,
    SecureRandom.layerWebCrypto
  )
  const session = Layer.effect(AgentSession, AgentSession.make({ keyModel: () => model })).pipe(
    Layer.provideMerge(Layer.mergeAll(AppSettingsStore.layer, Layer.effect(CliSetups, CliSetups.make)).pipe(Layer.provideMerge(base)))
  )
  return ManagedRuntime.make(
    RunManager.layer.pipe(
      Layer.provideMerge(PipelineStagesLive),
      Layer.provideMerge(Layer.mergeAll(
        RunStore.layer,
        Artifacts.layer,
        Sources.layer,
        Projects.layer,
        session,
        ElevenLabs.replay(() => new Uint8Array()),
        Transcriber.layer
      ))
    )
  )
}

test("the thumbnail step on a Gateway model sees its preview as an image, and its cost is billed", async () => {
  const rt = runtime()
  const projectId = await rt.runPromise(Effect.gen(function*() {
    yield* (yield* AppSettingsStore).setStageAgent("thumbnail", { provider: "ai-gateway", model: "anthropic/claude-haiku-5.5" })
    const source = yield* (yield* Sources).create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "owned", rightsNote: null })
    const artifacts = yield* Artifacts
    const sourceOwner = { _tag: "Source", id: source.id } as const
    const video = yield* artifacts.allocate(sourceOwner, "source-video")
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=d=30:s=320x180:r=10", join(video.dir, "source.mp4")])
    yield* artifacts.record(video, { data: null, path: join(video.relDir, "source.mp4") })
    const project = yield* (yield* Projects).create({ sourceIds: [source.id], title: "Candy", approach: "claim-interleaved", presetId: null, musicTrackId: null })
    for (const kind of ["script", "voiceover", "voiceover-transcript", "shot-plan", "narrated-plan", "render", "metadata"] as const) {
      yield* artifacts.record(yield* artifacts.allocate({ _tag: "Project", id: project.id }, kind), { data: null, path: "done" })
    }
    return project.id
  }))

  const cost = await rt.runPromise(Effect.gen(function*() {
    const runs = yield* RunManager
    const run = yield* runs.start({ _tag: "Project", id: projectId }, "thumbnail")
    const gate = yield* runs.subscribe(run.id, 0).pipe(
      Stream.filter((u: RunUpdate) => u._tag === "Event" && (u.event._tag === "RequestRaised" || u.event._tag === "RunFinished")),
      Stream.runHead,
      Effect.map(Option.getOrThrow)
    )
    if (gate._tag !== "Event" || gate.event._tag !== "RequestRaised") return assert.fail(JSON.stringify(gate))
    const request = gate.event.request
    const stageRuns = yield* (yield* RunStore).listStageRuns(run.id)
    yield* runs.respond(request.id, { _tag: "Approve" })
    return stageRuns.find((s) => s.id === request.stageRunId)
  }))

  assert.equal(calls.length, 2, "preview, then submit")
  // the system prompt says how images work here, and view_image is offered for the step's files
  assert.match(String(calls[0]!.prompt[0]!.content), /call view_image/)
  assert.ok(calls[0]!.tools?.some((t) => t.name === "view_image"))
  // the preview's draft came back as image content inside the tool result
  const results = calls[1]!.prompt.flatMap((m) => m.role === "tool" ? m.content.filter((p) => p.type === "tool-result") : [])
  const output = results[0]!.output
  assert.equal(output.type, "content")
  const file = output.type === "content" ? output.value.find((p) => p.type === "file") : undefined
  assert.ok(file !== undefined && file.type === "file" && file.mediaType === "image/jpeg", JSON.stringify(output).slice(0, 300))
  assert.ok(file.filename !== undefined && /thumbnail-preview.*\.jpg$/.test(file.filename) && existsSync(file.filename), file.filename)
  assert.equal(cost?.provider, "ai-gateway")
  assert.equal(cost?.billing, "billed")
  assert.equal(cost?.costUsd, 0.002)
  await rt.dispose()
})
