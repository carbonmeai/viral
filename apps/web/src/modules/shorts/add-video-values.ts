import type { SourceId } from "@viral/contracts"
import { isVideoLink } from "../videos/video-values.ts"

// The step a change to the short's videos (or its brief) re-runs from: the first agent step.
export const rerunStep = (format: "narrated" | "cut-down") => format === "cut-down" ? "sections" as const : "script" as const
export const stepTitle = (step: "script" | "sections") => step === "script" ? "Script" : "Sections"

// The library videos that can be added: the ones the short doesn't have yet.
export const addableVideos = <V extends { readonly source: { readonly id: SourceId } }>(library: ReadonlyArray<V>, inShort: ReadonlyArray<SourceId>) =>
  library.filter((v) => !inShort.includes(v.source.id))

// What was typed into "a link or file": a link, a file's full path, or nothing usable.
export const typedVideo = (text: string): { readonly _tag: "Url"; readonly url: string } | { readonly _tag: "File"; readonly path: string } | null => {
  const value = text.trim()
  if (isVideoLink(value)) return { _tag: "Url", url: value }
  return value.startsWith("/") ? { _tag: "File", path: value } : null
}

// What the server said when it refused to change the short's videos, in its own plain words.
export const refusalText = (error: unknown, fallback: string) =>
  typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" && error.message !== ""
    ? error.message
    : fallback
