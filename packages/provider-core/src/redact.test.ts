import assert from "node:assert/strict"
import { test } from "node:test"
import { REDACTED, redactSecrets } from "./redact.ts"

test("keys in headers, URLs and key-shaped strings are hidden; the rest of the message stays", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["Authorization: Bearer abcdefgh12345678 failed", `Authorization: Bearer ${REDACTED} failed`],
    [`{"x-api-key":"sk-ant-api03-zzzzzzzzzzzz"}`, `{"x-api-key":"${REDACTED}"}`],
    ["GET /v1beta/models?key=AIzaSyA0123456789abcdefghijk&pageSize=5", `GET /v1beta/models?key=${REDACTED}&pageSize=5`],
    ["Incorrect API key provided: sk-proj-abcdefghijkl.", `Incorrect API key provided: ${REDACTED}.`],
    ["xai-0123456789abcdef is blocked", `${REDACTED} is blocked`],
    ["x-goog-api-key = secretvalue123", `x-goog-api-key = ${REDACTED}`],
    ["rate limited, try again in 3s", "rate limited, try again in 3s"]
  ]
  for (const [input, expected] of cases) assert.equal(redactSecrets(input), expected)
})

test("a known value is hidden wherever it appears, even with no tell-tale shape", () => {
  assert.equal(redactSecrets("the key q1w2e3r4t5 was refused", ["q1w2e3r4t5"]), `the key ${REDACTED} was refused`)
})
