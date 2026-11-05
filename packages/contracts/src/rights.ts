import { Schema } from "effect"

// Whether we may use a piece of media: sources, music tracks and sound effects all carry this.
export const Rights = Schema.Literals(["unconfirmed", "owned", "licensed"])
export type Rights = typeof Rights.Type
