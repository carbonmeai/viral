import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { Effect, Layer, ManagedRuntime } from "effect"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/http"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, before, test } from "node:test"
import { ViralHome } from "../home/viral-home.ts"
import { HealthRouteLive, MediaRouteLive } from "./media-route.ts"

let home: string
let outside: string
before(() => {
  home = mkdtempSync(join(tmpdir(), "viral-media-"))
  outside = mkdtempSync(join(tmpdir(), "viral-outside-"))
  process.env.VIRAL_HOME = home
  mkdirSync(join(home, "projects", "p1", "shot-plan", "v1", "frames"), { recursive: true })
  writeFileSync(join(home, "projects", "p1", "shot-plan", "v1", "frames", "shot 01.jpg"), Buffer.from("0123456789"))
  writeFileSync(join(home, "viral.db"), "secret")
  writeFileSync(join(outside, "leak.txt"), "secret")
  // a link inside the media folders that points outside the home
  symlinkSync(outside, join(home, "projects", "p1", "escape"))
})
after(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

const runtime = () =>
  ManagedRuntime.make(
    HttpRouter.serve(Layer.mergeAll(MediaRouteLive, HealthRouteLive)).pipe(
      Layer.provide([ViralHome.layer, NodeServices.layer]),
      Layer.provideMerge(NodeHttpServer.layerTest)
    )
  )

const get = (path: string, headers: Record<string, string> = {}) =>
  Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    const res = yield* client.execute(HttpClientRequest.get(path).pipe(HttpClientRequest.setHeaders(headers)))
    return { status: res.status, headers: res.headers, body: yield* res.text }
  })

test("serves files from the media folders, with byte ranges", async () => {
  const rt = runtime()
  const whole = await rt.runPromise(get("/media/projects/p1/shot-plan/v1/frames/shot%2001.jpg"))
  assert.equal(whole.status, 200)
  assert.equal(whole.body, "0123456789")
  assert.equal(whole.headers["content-type"], "image/jpeg")
  assert.equal(whole.headers["accept-ranges"], "bytes")

  const part = await rt.runPromise(get("/media/projects/p1/shot-plan/v1/frames/shot%2001.jpg", { range: "bytes=2-5" }))
  assert.equal(part.status, 206)
  assert.equal(part.body, "2345")
  assert.equal(part.headers["content-range"], "bytes 2-5/10")

  const past = await rt.runPromise(get("/media/projects/p1/shot-plan/v1/frames/shot%2001.jpg", { range: "bytes=50-" }))
  assert.equal(past.status, 416)

  assert.equal((await rt.runPromise(get("/healthz"))).body, "ok")
  await rt.dispose()
})

test("never serves the database, paths outside the home, or links that leave it", async () => {
  const rt = runtime()
  for (const path of [
    "/media/viral.db",
    "/media/projects/p1/../../viral.db",
    "/media/projects%2F..%2F..%2Fviral.db",
    "/media/projects/p1/escape/leak.txt",
    "/media/projects/p1/missing.jpg",
    "/media/projects/p1/shot-plan"
  ]) {
    const res = await rt.runPromise(get(path))
    assert.equal(res.status, 404, path)
    assert.notEqual(res.body, "secret", path)
  }
  await rt.dispose()
})
