import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { AgentStage } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Select } from "@viral/ui/primitives/select"
import { SettingRow, SettingsGroup } from "@viral/ui/primitives/setting-row"
import { useState } from "react"
import { appSettingsAtom, setStageModel } from "../settings-api.ts"
import { Loaded, SettingsPage } from "../settings-page.tsx"

// Each agent stage, what it does, and the model it uses when you don't choose one.
const STAGES: ReadonlyArray<{ readonly stage: AgentStage; readonly label: string; readonly sub: string; readonly fallback: string }> = [
  { stage: "ads", label: "Ads", sub: "Finds sponsor reads, ads and end screens to keep out of shorts.", fallback: "Haiku" },
  { stage: "story", label: "Story", sub: "Maps the long video's story and proposes three shorts.", fallback: "your CLI's model" },
  { stage: "script", label: "Script", sub: "Writes the narration and picks the real lines.", fallback: "your CLI's model" },
  { stage: "shots", label: "Shots", sub: "Looks at the video and picks the footage under each word.", fallback: "your CLI's model" },
  { stage: "metadata", label: "Metadata", sub: "Writes the title, description and hashtags.", fallback: "Haiku" }
]

const KNOWN = ["opus", "sonnet", "haiku"] as const
type Choice = "default" | (typeof KNOWN)[number] | "custom"

const choiceOf = (model: string | null): Choice =>
  model === null ? "default" : (KNOWN as ReadonlyArray<string>).includes(model) ? (model as Choice) : "custom"

// Settings › Agents: the Claude model behind each agent stage. Default keeps the stage's own choice.
export function AgentsPage() {
  const settings = useAtomValue(appSettingsAtom)
  return (
    <SettingsPage section="agents" description="The Claude model behind each step. Default uses the step’s own choice.">
      <Loaded result={settings} what="your settings">
        {(value) => (
          <SettingsGroup>
            {STAGES.map((s) => <StageRow key={s.stage} {...s} model={value.stageModels[s.stage]} />)}
          </SettingsGroup>
        )}
      </Loaded>
    </SettingsPage>
  )
}

function StageRow({ stage, label, sub, fallback, model }: {
  readonly stage: AgentStage
  readonly label: string
  readonly sub: string
  readonly fallback: string
  readonly model: string | null
}) {
  const save = useAtomSet(setStageModel, { mode: "promise" })
  const [custom, setCustom] = useState<string | null>(choiceOf(model) === "custom" ? model : null)
  const choice: Choice = custom !== null ? "custom" : choiceOf(model)
  const set = (next: string | null) => void save({ payload: { stage, model: next }, reactivityKeys: ["settings"] }).catch(() => undefined)

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
          if (next === "custom") return setCustom(model ?? "")
          setCustom(null)
          set(next === "default" ? null : next)
        }}
        options={[
          { value: "default", label: "Default", note: fallback },
          { value: "opus", label: "Opus" },
          { value: "sonnet", label: "Sonnet" },
          { value: "haiku", label: "Haiku" },
          { value: "custom", label: "Custom…" }
        ]}
      />
    </SettingRow>
  )
}
