import { Effect, Exit } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { BUILT_IN_PRESETS, DEFAULT_PRESET_CONFIG, DEFAULT_PRESET_NAME } from "./built-in-presets.ts"
import { Presets } from "./presets.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-presets-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

const run = <A, E>(effect: Effect.Effect<A, E, Presets>) => Effect.runPromise(Effect.provide(effect, Presets.layer))

test("ensures the built-in presets once, with Viral recap as the default", async () => {
  await run(Effect.void)
  const presets = await run(Effect.gen(function*() {
    return yield* (yield* Presets).list
  }))
  assert.deepEqual(presets.map((p) => p.name).sort(), BUILT_IN_PRESETS.map((p) => p.name).sort())
  const recap = presets.find((p) => p.isDefault)!
  assert.equal(recap.name, DEFAULT_PRESET_NAME)
  assert.deepEqual(recap.config, DEFAULT_PRESET_CONFIG)
  const headline = presets.find((p) => p.name === "Headline full-bleed")!
  assert.equal(headline.config.framing, "full")
  assert.equal(headline.config.captions.mode, "chunk")
})

test("moves the default, protects it from deletion and rejects duplicate names", async () => {
  const result = await run(Effect.gen(function*() {
    const presets = yield* Presets
    const original = yield* presets.getDefault
    const capcut = yield* presets.create("CapCut hand-off", {
      ...DEFAULT_PRESET_CONFIG,
      captions: { ...DEFAULT_PRESET_CONFIG.captions, enabled: false }
    })
    yield* presets.setDefault(capcut.id)
    return {
      original,
      capcut,
      current: yield* presets.getDefault,
      deleteDefault: yield* Effect.exit(presets.remove(capcut.id)),
      deleteOriginal: yield* presets.remove(original.id),
      duplicate: yield* Effect.exit(presets.create("CapCut hand-off", DEFAULT_PRESET_CONFIG))
    }
  }))
  assert.equal(result.current.id, result.capcut.id)
  assert.equal(result.current.config.captions.enabled, false)
  assert.ok(Exit.isFailure(result.deleteDefault))
  assert.equal(result.deleteOriginal, true)
  assert.ok(Exit.isFailure(result.duplicate))
})

test("edits are checked before they're saved, and renames keep names unique", async () => {
  const [edited, refused, renamed, taken, blank] = await run(Effect.gen(function*() {
    const presets = yield* Presets
    const style = yield* presets.create("Edit me", DEFAULT_PRESET_CONFIG)
    const edited = yield* presets.edit(style.id, { ...style.config, captions: { ...style.config.captions, highlight: "#FF3B30" } })
    const refused = yield* presets.edit(style.id, { ...style.config, loudnessLufs: 3 }).pipe(Effect.flip)
    const renamed = yield* presets.rename(style.id, "  Red pop  ")
    const taken = yield* presets.rename(style.id, DEFAULT_PRESET_NAME).pipe(Effect.flip)
    const blank = yield* presets.rename(style.id, "   ").pipe(Effect.flip)
    return [edited, refused, renamed, taken, blank] as const
  }))
  assert.equal(edited.config.captions.highlight, "#FF3B30")
  assert.ok(refused._tag === "PresetInvalid" && refused.problems.some((p) => p.includes("loudness")))
  assert.equal(renamed.name, "Red pop")
  assert.equal(renamed.config.captions.highlight, "#FF3B30", "an invalid edit changed nothing")
  assert.equal(taken._tag, "PresetNameTaken")
  assert.equal(blank._tag, "PresetInvalid")
})
