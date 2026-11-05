import { Effect, Exit } from "effect"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { DEFAULT_PRESET_CONFIG, DEFAULT_PRESET_NAME } from "./default-preset.ts"
import { Presets } from "./presets.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-presets-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

const run = <A, E>(effect: Effect.Effect<A, E, Presets>) => Effect.runPromise(Effect.provide(effect, Presets.layer))

test("seeds the default preset once", async () => {
  await run(Effect.void)
  const presets = await run(Effect.gen(function*() {
    return yield* (yield* Presets).list
  }))
  assert.equal(presets.length, 1)
  assert.equal(presets[0]!.name, DEFAULT_PRESET_NAME)
  assert.equal(presets[0]!.isDefault, true)
  assert.deepEqual(presets[0]!.config, DEFAULT_PRESET_CONFIG)
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
