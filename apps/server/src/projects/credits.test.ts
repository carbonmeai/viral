import assert from "node:assert/strict"
import { test } from "node:test"
import { creditedChannels, creditLine } from "./credits.ts"

test("credits each channel that isn't yours once, in video order", () => {
  const sources = [
    { rights: "licensed", channel: "NileBlue" },
    { rights: "owned", channel: "Me" },
    { rights: "unconfirmed", channel: "Mark Rober" },
    { rights: "licensed", channel: "NileBlue" },
    { rights: "licensed", channel: null }
  ]
  assert.deepEqual(creditedChannels(sources), ["NileBlue", "Mark Rober"])
  assert.equal(creditLine(sources), "Video: NileBlue · Mark Rober")
  assert.equal(creditLine([{ rights: "licensed", channel: "NileBlue" }]), "Video: NileBlue", "one video reads as before")
  assert.equal(creditLine([{ rights: "owned", channel: "Me" }]), null)
})
