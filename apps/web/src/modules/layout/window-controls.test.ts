import assert from "node:assert/strict"
import { test } from "node:test"
import { windowControlsInset } from "./window-controls.ts"

test("the window buttons' room is kept in a window and given back in full screen or a browser", () => {
  const bridge = { windowControlsInset: 76 }
  assert.equal(windowControlsInset(bridge, false), 76)
  assert.equal(windowControlsInset(bridge, true), 0)
  assert.equal(windowControlsInset(undefined, false), 0)
})
