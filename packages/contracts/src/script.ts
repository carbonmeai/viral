import { Schema } from "effect"

export const Script = Schema.Struct({
  hook: Schema.String,
  lines: Schema.Array(Schema.String)
})
export type Script = typeof Script.Type
