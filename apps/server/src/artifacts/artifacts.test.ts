import { ProjectId, SourceId } from "@viral/contracts"
import { Effect, Option } from "effect"
import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { Sources } from "../sources/sources.ts"
import { Artifacts } from "./artifacts.ts"

let home: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-artifacts-"))
  process.env.VIRAL_HOME = home
})
after(() => rmSync(home, { recursive: true, force: true }))

test("versions each kind per owner, in its own folder", async () => {
  const result = await Effect.runPromise(Effect.gen(function*() {
    const sources = yield* Sources
    const artifacts = yield* Artifacts
    const source = yield* sources.create({ origin: { _tag: "Url", url: "https://youtu.be/x" }, rights: "owned", rightsNote: null })
    const owner = { _tag: "Source", id: source.id } as const

    const v1 = yield* artifacts.allocate(owner, "transcript")
    yield* artifacts.record(v1, { data: { provider: "grok" }, path: join(v1.relDir, "transcript.json") })
    const v2 = yield* artifacts.allocate(owner, "transcript")
    const second = yield* artifacts.record(v2, { data: null, path: join(v2.relDir, "transcript.json") })
    const sheets = yield* artifacts.allocate(owner, "contact-sheet")
    yield* artifacts.record(sheets, { data: { frames: 10 }, path: sheets.relDir })

    return {
      source,
      v1,
      v2,
      second,
      latest: yield* artifacts.latest(owner, "transcript"),
      missing: yield* artifacts.latest({ _tag: "Project", id: ProjectId.make("none") }, "script"),
      all: yield* artifacts.list(owner)
    }
  }).pipe(Effect.provide([Artifacts.layer, Sources.layer])))

  assert.deepEqual([result.v1.version, result.v2.version], [1, 2])
  assert.equal(result.v2.relDir, join("transcript", "v2"))
  assert.ok(existsSync(join(home, "sources", result.source.id, "transcript", "v2")))
  assert.equal(Option.getOrThrow(result.latest).id, result.second.id)
  assert.ok(Option.isNone(result.missing))
  assert.deepEqual(result.all.map((a) => `${a.kind}@${a.version}`), ["contact-sheet@1", "transcript@2", "transcript@1"])
  assert.deepEqual(result.all.find((a) => a.version === 1 && a.kind === "transcript")!.data, { provider: "grok" })
  assert.deepEqual(result.all[0]!.owner, { _tag: "Source", id: SourceId.make(result.source.id) })
})
