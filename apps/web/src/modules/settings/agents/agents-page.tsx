import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { type AgentProvider, type AgentStage, GATEWAY_MODELS } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Select } from "@viral/ui/primitives/select"
import { SettingRow, SettingsGroup } from "@viral/ui/primitives/setting-row"
import { Status } from "@viral/ui/primitives/status"
import { useState } from "react"
import { appSettingsAtom, setStageModel, setStageProvider } from "../settings-api.ts"
import { Loaded, SettingsPage } from "../settings-page.tsx"

// Each agent stage, what it does, and the model it uses when you don't choose one.
const STAGES: ReadonlyArray<{ readonly stage: AgentStage; readonly label: string; readonly sub: string; readonly fallback: string }> = [
  { stage: "ads", label: "Ads", sub: "Finds sponsor reads, ads and end screens to keep out of shorts.", fallback: "Haiku" },
  { stage: "story", label: "Story", sub: "Maps the long video's story and proposes three shorts.", fallback: "your CLI's model" },
  { stage: "script", label: "Script", sub: "Writes the narration and picks the real lines.", fallback: "your CLI's model" },
  { stage: "shots", label: "Shots", sub: "Looks at the video and picks the footage under each word.", fallback: "your CLI's model" },
  { stage: "sections", label: "Sections", sub: "Picks the creator's best moments for a cut-down short.", fallback: "your CLI's model" },
  { stage: "metadata", label: "Metadata", sub: "Writes the title, description and hashtags.", fallback: "Haiku" },
  { stage: "thumbnail", label: "Thumbnail", sub: "Picks the hero, the face and the words for the thumbnail.", fallback: "your CLI's model" }
]

const KNOWN = ["opus", "sonnet", "haiku"] as const
// "gateway" opens the experimental AI Gateway choice for the stage
type Choice = "default" | (typeof KNOWN)[number] | "custom" | "gateway"

const choiceOf = (model: string | null): Choice =>
  model === null ? "default" : (KNOWN as ReadonlyArray<string>).includes(model) ? (model as Choice) : "custom"

// Settings › Agents: the Claude model behind each agent stage. Default keeps the stage's own choice. A stage can
// also be switched to the experimental AI Gateway to try another model; the Claude CLI stays the default.
export function AgentsPage() {
  const settings = useAtomValue(appSettingsAtom)
  return (
    <SettingsPage section="agents" description="The Claude model behind each step. Default uses the step’s own choice.">
      <Loaded result={settings} what="your settings">
        {(value) => (
          <SettingsGroup>
            {STAGES.map((s) => (
              <StageRow key={s.stage} {...s} model={value.stageModels[s.stage]} provider={value.stageProviders[s.stage]} />
            ))}
          </SettingsGroup>
        )}
      </Loaded>
    </SettingsPage>
  )
}

function StageRow({ stage, label, sub, fallback, model, provider }: {
  readonly stage: AgentStage
  readonly label: string
  readonly sub: string
  readonly fallback: string
  readonly model: string | null
  readonly provider: AgentProvider
}) {
  const save = useAtomSet(setStageModel, { mode: "promise" })
  const route = useAtomSet(setStageProvider, { mode: "promise" })
  const [custom, setCustom] = useState<string | null>(provider === "claude-cli" && choiceOf(model) === "custom" ? model : null)
  const set = (next: string | null) => void save({ payload: { stage, model: next }, reactivityKeys: ["settings"] }).catch(() => undefined)
  const switchTo = (next: AgentProvider, nextModel: string | null) =>
    void route({ payload: { stage, provider: next, model: nextModel }, reactivityKeys: ["settings"] }).catch(() => undefined)

  if (provider === "ai-gateway") return <GatewayRow label={label} sub={sub} model={model} onModel={(m) => switchTo("ai-gateway", m)} onBack={() => switchTo("claude-cli", null)} />

  const choice: Choice = custom !== null ? "custom" : choiceOf(model)
  return (
    <SettingRow label={label} sub={sub}>
      {choice === "custom"
        ? (
          <>
            <Input
              aria-label={`${label} model id`}
              className="w-[220px]"
              value={custom ?? ""}
              placeholder="e.g. claude-opus-5-5"
              onChange={(e) => setCustom(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && set(custom)}
            />
            <Button onClick={() => set(custom)}>Save</Button>
          </>
        )
        : null}
      <Select<Choice>
        label={`${label} model`}
        value={choice}
        onChange={(next) => {
          if (next === "gateway") return switchTo("ai-gateway", GATEWAY_MODELS[0]?.id ?? null)
          if (next === "custom") return setCustom(model ?? "")
          setCustom(null)
          set(next === "default" ? null : next)
        }}
        options={[
          { value: "default", label: "Default", note: fallback },
          { value: "opus", label: "Opus" },
          { value: "sonnet", label: "Sonnet" },
          { value: "haiku", label: "Haiku" },
          { value: "custom", label: "Custom…" },
          { value: "gateway", label: "AI Gateway…", note: "Experimental" }
        ]}
      />
    </SettingRow>
  )
}

// A stage on the experimental AI Gateway: which gateway model, and a way back to the Claude CLI.
function GatewayRow({ label, sub, model, onModel, onBack }: {
  readonly label: string
  readonly sub: string
  readonly model: string | null
  readonly onModel: (model: string) => void
  readonly onBack: () => void
}) {
  const known = GATEWAY_MODELS.some((m) => m.id === model)
  const [custom, setCustom] = useState<string | null>(known ? null : model ?? "")
  return (
    <SettingRow label={label} sub={`${sub} Experimental: runs on the AI Gateway instead of your Claude CLI.`}>
      <Status tone="wait">Experimental</Status>
      {custom !== null
        ? (
          <>
            <Input
              aria-label={`${label} gateway model id`}
              className="w-[220px]"
              value={custom}
              placeholder="e.g. openai/gpt-6-luna"
              onChange={(e) => setCustom(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && custom.trim() !== "" && onModel(custom.trim())}
            />
            <Button disabled={custom.trim() === ""} onClick={() => onModel(custom.trim())}>Save</Button>
          </>
        )
        : null}
      <Select<string>
        label={`${label} gateway model`}
        value={custom !== null ? "custom" : model ?? ""}
        onChange={(next) => {
          if (next === "custom") return setCustom(model ?? "")
          setCustom(null)
          onModel(next)
        }}
        options={[...GATEWAY_MODELS.map((m) => ({ value: m.id, label: m.label })), { value: "custom", label: "Other gateway id…" }]}
      />
      <Button variant="ghost" onClick={onBack}>Use Claude CLI</Button>
    </SettingRow>
  )
}
