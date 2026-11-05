import { NarratedPlan } from "@viral/contracts"
import { Effect, Exit, Schema } from "effect"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { RenderEngine, RenderError } from "./render-engine.ts"

const FIXTURE = join(homedir(), ".viral/fixtures/candy")
const hasFixture = existsSync(join(FIXTURE, "source.mp4"))

let work: string
before(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), "viral-render-")))
  process.env.VIRAL_HOME = join(work, "home")
})
after(() => rmSync(work, { recursive: true, force: true }))

const candyPlan = (): NarratedPlan => ({
  ...Schema.decodeUnknownSync(NarratedPlan)(JSON.parse(readFileSync(join(FIXTURE, "narrated.json"), "utf8"))),
  source: join(FIXTURE, "source.mp4"),
  source_transcript: join(FIXTURE, "transcript.json"),
  voiceover: join(FIXTURE, "vo.wav"),
  voiceover_transcript: join(FIXTURE, "vo_tx/transcript.json")
})

// Both checks fail before any shot is cut, so these run in about a second.
const renderError = async (plan: NarratedPlan) => {
  const exit = await Effect.runPromiseExit(Effect.gen(function*() {
    const render = yield* RenderEngine
    return yield* render.renderNarrated(plan, work, join(work, "out.mp4"), () => Effect.void)
  }).pipe(Effect.provide(RenderEngine.layer)))
  assert.ok(Exit.isFailure(exit))
  const error = exit.cause.reasons.find((reason) => reason._tag === "Fail")
  assert.ok(error !== undefined && Schema.is(RenderError)(error.error), "fails with a RenderError")
  return error.error
}

test("a stale word anchor fails with anchor-mismatch", { skip: !hasFixture }, async () => {
  const plan = candyPlan()
  const [first, ...rest] = plan.shots
  const error = await renderError({ ...plan, shots: [{ ...first!, word_text: "Nope" }, ...rest] })
  assert.equal(error.code, "anchor-mismatch")
  assert.match(error.message, /plan expects 'Nope'/)
})

test("a shot inside an ad range fails with excluded-range", { skip: !hasFixture }, async () => {
  const plan = candyPlan()
  const firstSrc = plan.shots[0]!.src
  const error = await renderError({ ...plan, exclude: [[firstSrc, firstSrc + 1]] })
  assert.equal(error.code, "excluded-range")
})
