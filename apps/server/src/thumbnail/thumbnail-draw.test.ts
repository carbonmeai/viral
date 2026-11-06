import { Effect } from "effect"
import assert from "node:assert/strict"
import { test } from "node:test"
import { cutoutSummary, drawThumbnail, NEEDS_REMBG } from "./thumbnail-draw.ts"
import type { Drawn } from "./thumbnail-renderer.ts"

// A draw that returns each drawing in turn, counting calls.
const drawing = (...results: ReadonlyArray<Drawn>) => {
  let calls = 0
  return { draw: Effect.sync(() => results[Math.min(calls++, results.length - 1)]!), calls: () => calls }
}
const fetching = (answer: "ready" | "unavailable") => {
  let calls = 0
  return { fetch: Effect.sync(() => (calls++, answer)), calls: () => calls }
}

test("Apple's cut-out draws once and fetches nothing", async () => {
  const d = drawing({ image: "a.jpg", cutouts: { hero: "apple", face: "apple" } })
  const f = fetching("ready")
  const drawn = await Effect.runPromise(drawThumbnail(d.draw, f.fetch))
  assert.deepEqual([drawn.cutouts.hero, d.calls(), f.calls()], ["apple", 1, 0])
})

test("a layer that needs rembg fetches its models, then draws again", async () => {
  const d = drawing({ image: "a.jpg", cutouts: { hero: "apple", face: NEEDS_REMBG } }, { image: "a.jpg", cutouts: { hero: "apple", face: "rembg" } })
  const f = fetching("ready")
  const drawn = await Effect.runPromise(drawThumbnail(d.draw, f.fetch))
  assert.deepEqual([drawn.cutouts.face, d.calls(), f.calls()], ["rembg", 2, 1])
})

test("when the models can't be fetched, the first drawing (with a framed inset) stands", async () => {
  const d = drawing({ image: "a.jpg", cutouts: { hero: NEEDS_REMBG } })
  const f = fetching("unavailable")
  const drawn = await Effect.runPromise(drawThumbnail(d.draw, f.fetch))
  assert.deepEqual([drawn.cutouts.hero, d.calls(), f.calls()], [NEEDS_REMBG, 1, 1])
})

test("the progress line names each layer's method", () => {
  assert.equal(cutoutSummary({ image: "a.jpg", cutouts: { hero: "apple", face: "fallback: no clear subject" } }), "hero: Apple's cut-out · face: framed inset")
  assert.equal(cutoutSummary({ image: "a.jpg", cutouts: {} }), "")
})
