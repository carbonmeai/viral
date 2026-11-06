import type { StageName, StageRun } from "@viral/contracts"
import { Detail } from "../system/detail.tsx"
import { Facts, InspectorBlock } from "./editor-frame.tsx"

// "claude-opus-5-5[1m]" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5", "eleven_v4" as it is
const modelName = (model: string | null) => {
  if (model === null) return "—"
  const short = model.replace(/^claude-/, "").replace(/\[1m\]$/, "").replace(/-\d{8}$/, "").replace(/-(\d+)-(\d+)$/, " $1.$2")
  return short === model ? model : short.charAt(0).toUpperCase() + short.slice(1)
}

// The step's model, what it cost and how many tries it took, in Detailed mode.
export function StepDetails({ stages, names }: { readonly stages: ReadonlyArray<StageRun>; readonly names: ReadonlyArray<StageName> }) {
  const runs = stages.filter((s) => names.includes(s.stage))
  if (runs.length === 0) return null
  const latest = runs.reduce((a, b) => (b.attempt >= a.attempt ? b : a))
  if (runs.every((r) => r.status === "reused")) {
    return (
      <Detail>
        <InspectorBlock title="This step">
          <span className="text-xs text-fg-2">Made in an earlier run and kept, so it cost nothing this time.</span>
        </InspectorBlock>
      </Detail>
    )
  }
  const cost = runs.reduce((n, s) => n + (s.costUsd ?? 0), 0)
  const chars = runs.reduce((n, s) => n + (s.ttsCharacters ?? 0), 0)
  const ms = runs.reduce((n, s) => n + (s.durationMs ?? 0), 0)
  // a step that runs a program (assemble, render) has no model; it shows how long it took on this Mac
  const model = runs.map((r) => r.model).findLast((m) => m !== null) ?? null
  return (
    <Detail>
      <InspectorBlock title="This step">
        <Facts
          rows={[
            ...(model === null ? [] : [["Model", modelName(latest.model ?? model)] as const]),
            ...(model === null && ms > 0 ? [["Time", `${Math.round(ms / 1000)}s on this Mac`] as const] : []),
            ...(cost > 0 ? [["Cost", `$${cost.toFixed(2)}`] as const] : []),
            ...(chars > 0 ? [["Characters", String(chars)] as const] : []),
            ["Tries", String(runs.length)]
          ]}
        />
      </InspectorBlock>
    </Detail>
  )
}
