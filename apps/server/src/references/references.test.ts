import { Effect, Exit, Layer } from "effect"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Artifacts } from "../artifacts/artifacts.ts"
import { References } from "./references.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-references-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

const run = <A, E>(effect: Effect.Effect<A, E, References | Artifacts>) =>
  Effect.runPromise(Effect.provide(effect, Layer.mergeAll(References.layer, Artifacts.layer)))

test("keeps reference videos with their platform and owns their analysis artifacts", async () => {
  const { tiktok, other, analysis } = await run(Effect.gen(function*() {
    const references = yield* References
    const artifacts = yield* Artifacts
    const tiktok = yield* references.create("https://www.tiktok.com/@creator/video/123", "great drop timing")
    const other = yield* references.create("https://example.com/clip", null)
    const owner = { _tag: "Reference", id: tiktok.id } as const
    const slot = yield* artifacts.allocate(owner, "reference-analysis")
    const analysis = yield* artifacts.record(slot, { data: { cutsPerSecond: 0.8 }, path: null })
    return { tiktok, other, analysis }
  }))
  assert.equal(tiktok.platform, "tiktok")
  assert.equal(other.platform, null)
  assert.deepEqual(analysis.owner, { _tag: "Reference", id: tiktok.id })
  assert.ok(existsSync(join(home, "references", tiktok.id, "reference-analysis", "v1")))

  const [removed, lookup, leftover] = await run(Effect.gen(function*() {
    const references = yield* References
    return [
      yield* references.remove(tiktok.id),
      yield* Effect.exit(references.get(tiktok.id)),
      yield* (yield* Artifacts).list({ _tag: "Reference", id: tiktok.id })
    ] as const
  }))
  assert.equal(removed, true)
  assert.ok(Exit.isFailure(lookup))
  assert.deepEqual(leftover, [], "deleting a reference deletes its analyses")
  assert.ok(!existsSync(join(home, "references", tiktok.id)))
})
