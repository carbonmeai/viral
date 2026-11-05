import assert from "node:assert/strict"
import { test } from "node:test"
import { projectSlug } from "./project-slug.ts"

test("prefixes the zero-padded number and kebab-cases the title", () => {
  assert.equal(projectSlug(1, "He Put Every Taste Into One Candy!"), "01-he-put-every-taste-into-one-candy")
  assert.equal(projectSlug(12, "  Crème brûlée — 100 ways "), "12-creme-brulee-100-ways")
})

test("falls back when the title has no usable characters", () => {
  assert.equal(projectSlug(3, "🔥🔥"), "03-short")
})
