import assert from "node:assert/strict"
import { test } from "node:test"
import { isInsideLibrary } from "./finder-path.ts"

test("only the library and what's inside it can be revealed", () => {
  assert.ok(isInsideLibrary("/Users/me/.viral", "/Users/me/.viral"))
  assert.ok(isInsideLibrary("/Users/me/.viral", "/Users/me/.viral/renders/a.mp4"))
  assert.ok(!isInsideLibrary("/Users/me/.viral", "/Users/me/.viral/../Documents"))
  assert.ok(!isInsideLibrary("/Users/me/.viral", "/Users/me/.viral-other"))
  assert.ok(!isInsideLibrary("/Users/me/.viral", "/etc/passwd"))
})
