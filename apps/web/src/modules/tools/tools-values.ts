import type { Tool, ToolName, ToolProgress } from "@viral/contracts"

export type InstallPhase = "waiting" | "downloading" | "installed" | "failed"

export interface ToolInstall {
  readonly phase: InstallPhase
  readonly bytes: number
  readonly total: number | null
  readonly version: string | null
  readonly message: string | null
}

// only the tools being installed
export type InstallState = Readonly<Partial<Record<ToolName, ToolInstall>>>

// What the setup screen describes each tool as.
export const TOOL_PURPOSE: Record<ToolName, string> = {
  ffmpeg: "Cuts, joins and encodes video and audio",
  ffprobe: "Reads a video's length and streams",
  uv: "Runs the transcription, contact-sheet and render scripts",
  "yt-dlp": "Downloads videos from a link",
  "background-removal": "Lifts the hero and the face out of their frames for bold thumbnails. Fetched in the background"
}

// The tools first run still has to set up: required ones that are missing, or failed last time. The
// background-removal models aren't required; they download on their own.
export const toolsToInstall = (tools: ReadonlyArray<Tool>): ReadonlyArray<Tool> => tools.filter((t) => t.required && t.status !== "ready")

// How far a background download has got, 0–1, or null while its size isn't known.
export const downloadFraction = (tool: Tool): number | null =>
  tool.progress === null || tool.progress.total === null || tool.progress.total === 0 ? null : tool.progress.bytes / tool.progress.total

// Before anything arrives, every tool to install is waiting.
export const initialInstall = (tools: ReadonlyArray<Tool>): InstallState => {
  const waiting: ToolInstall = { phase: "waiting", bytes: 0, total: null, version: null, message: null }
  return Object.fromEntries(toolsToInstall(tools).map((t) => [t.name, waiting])) as InstallState
}

// Folds one progress event from InstallTools into the state.
export const foldInstall = (state: InstallState, event: ToolProgress): InstallState => {
  switch (event._tag) {
    case "Downloading":
      return { ...state, [event.name]: { phase: "downloading", bytes: event.bytes, total: event.total, version: null, message: null } }
    case "Installed": {
      const before = state[event.tool.name]
      return {
        ...state,
        [event.tool.name]: { phase: "installed", bytes: before?.total ?? before?.bytes ?? 0, total: before?.total ?? null, version: event.tool.version, message: null }
      }
    }
    case "Failed":
      return { ...state, [event.name]: { phase: "failed", bytes: 0, total: null, version: null, message: event.message } }
  }
}

// Every tool has either installed or failed.
export const installFinished = (state: InstallState) => Object.values(state).every((t) => t === undefined || t.phase === "installed" || t.phase === "failed")

export const formatBytes = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

// "ffprobe version 6.0 Copyright (c) …" → "6.0"; "uv 0.13.7 (316c…)" → "0.13.7"; falls back to the line itself.
export const shortVersion = (version: string | null): string | null =>
  version === null ? null : (version.match(/\d+(?:\.\d+)+/)?.[0] ?? version)

export const sourceLabel = (tool: Tool) => tool.source === "viral" ? "Viral" : tool.source === "system" ? "System" : "—"
