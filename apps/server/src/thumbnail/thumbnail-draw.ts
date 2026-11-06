import { Effect } from "effect"
import type { Drawn } from "./thumbnail-renderer.ts"

// What render-thumbnail.py reports for a layer Apple's cut-out couldn't do while rembg's models aren't on disk.
export const NEEDS_REMBG = "fallback: needs rembg models"

export const needsRembg = (drawn: Drawn) => Object.values(drawn.cutouts).some((how) => how === NEEDS_REMBG)

const METHOD_NAMES: Record<string, string> = { apple: "Apple's cut-out", rembg: "rembg" }

// "hero: Apple's cut-out · face: framed inset", for the stage's progress line; empty for a classic thumbnail.
export const cutoutSummary = (drawn: Drawn) =>
  Object.entries(drawn.cutouts).map(([layer, how]) => `${layer}: ${METHOD_NAMES[how] ?? "framed inset"}`).join(" · ")

// Draws a thumbnail. Apple's cut-out needs no download; only when it fails and rembg's models aren't there yet
// are they fetched (with progress) and the thumbnail drawn once more. Without them, the first drawing (with
// framed insets for those layers) stands.
export const drawThumbnail = <E, R>(
  draw: Effect.Effect<Drawn, E, R>,
  fetchRembg: Effect.Effect<"ready" | "unavailable">
): Effect.Effect<Drawn, E, R> =>
  Effect.gen(function*() {
    const first = yield* draw
    if (!needsRembg(first)) return first
    return (yield* fetchRembg) === "ready" ? yield* draw : first
  })
