import { Console, Effect, Schema } from "effect"

// Prints a value in its wire (JSON) form, e.g. dates as ISO strings, for the `show` commands.
export const show = <S extends Schema.Top>(schema: S) => (value: S["Type"]) =>
  Schema.encodeEffect(Schema.toCodecJson(schema))(value).pipe(
    Effect.flatMap((json) => Console.dir(json, { depth: null }))
  )
