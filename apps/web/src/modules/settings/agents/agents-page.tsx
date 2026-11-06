import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import {
  type AgentChoice,
  type AgentProvider,
  type AgentRoute,
  type AgentStage,
  type AppSettings,
  CLI_MODELS,
  CLI_ONLY_STAGES,
  GATEWAY_MODELS,
  type ModelEval
} from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Row, RowTitle } from "@viral/ui/primitives/row"
import { Select } from "@viral/ui/primitives/select"
import { SettingRow, SettingsGroup } from "@viral/ui/primitives/setting-row"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useState } from "react"
import { modeAtom } from "../../system/preferences.ts"
import { accountsAtom, appSettingsAtom, modelEvalsAtom, setDefaultAgent, setStageAgent } from "../settings-api.ts"
import { Loaded, SettingsPage, SettingsSkeleton } from "../settings-page.tsx"
import { evalLabel, evalLine, modelLabel, providerName } from "./agents-values.ts"

// Each agent step, and what it does.
const STAGES: ReadonlyArray<{ readonly stage: AgentStage; readonly label: string; readonly sub: string }> = [
  { stage: "ads", label: "Ads", sub: "Finds sponsor reads, ads and end screens to keep out of shorts." },
  { stage: "story", label: "Story", sub: "Maps the long video's story and proposes three shorts." },
  { stage: "script", label: "Script", sub: "Writes the narration and picks the real lines." },
  { stage: "shots", label: "Shots", sub: "Looks at the video and picks the footage under each word." },
  { stage: "sections", label: "Sections", sub: "Picks the creator's best moments for a cut-down short." },
  { stage: "metadata", label: "Metadata", sub: "Writes the title, description and hashtags." },
  { stage: "thumbnail", label: "Thumbnail", sub: "Picks the hero, the face and the words for the thumbnail." }
]

// Settings › Agents: who runs the agent steps and on which model. One default for every step, then any step
// can have its own choice. The Claude CLI is the default out of the box; with an AI Gateway key, other models
// (Haiku 5.5, GPT-6 Luna, Gemini…) can run the text steps.
export function AgentsPage() {
  const settings = useAtomValue(appSettingsAtom)
  const accounts = useAtomValue(accountsAtom)
  const evals = useAtomValue(modelEvalsAtom)
  const detailed = useAtomValue(modeAtom) === "detailed"
  const gatewayReady = Option.match(AsyncResult.value(accounts), {
    onNone: () => false,
    onSome: (list) => list.some((a) => a.name === "gateway" && a.status === "ready")
  })
  const evalList = Option.getOrElse(AsyncResult.value(evals), (): ReadonlyArray<ModelEval> => [])

  return (
    <SettingsPage section="agents" description="Who runs each step, and on which model. Set a default for all steps, then change any step on its own.">
      <Loaded result={settings} what="your settings" skeleton={<SettingsSkeleton groups={[2, 7]} titled />}>
        {(value) => (
          <>
            <DefaultGroup settings={value} gatewayReady={gatewayReady} evals={detailed ? evalList : []} />
            <SettingsGroup title="Each step">
              {STAGES.map((s) => (
                <StageRow
                  key={s.stage}
                  {...s}
                  own={value.stageAgents[s.stage]}
                  route={value.routes[s.stage]}
                  gatewayReady={gatewayReady}
                  evals={detailed ? evalList : []}
                />
              ))}
            </SettingsGroup>
            {detailed && evalList.length > 0 ? <EvalsGroup evals={evalList} /> : null}
          </>
        )}
      </Loaded>
    </SettingsPage>
  )
}

function DefaultGroup({ settings, gatewayReady, evals }: {
  readonly settings: AppSettings
  readonly gatewayReady: boolean
  readonly evals: ReadonlyArray<ModelEval>
}) {
  const save = useAtomSet(setDefaultAgent, { mode: "promise" })
  const [error, setError] = useState<string | null>(null)
  const set = (agent: AgentChoice) =>
    void save({ payload: { agent }, reactivityKeys: ["settings"] })
      .then(() => setError(null))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn’t save"))
  const current = settings.defaultAgent
  const stat = evalLine(evals, current)
  return (
    <SettingsGroup title="Default for all steps">
      <SettingRow
        label="Provider"
        sub={gatewayReady
          ? "Who runs every step that hasn’t got its own choice."
          : <>Who runs every step. For other models, <Link to="/settings/accounts" className="underline">add an AI Gateway key in Accounts</Link>.</>}
      >
        <ProviderSelect
          label="Default provider"
          value={current.provider}
          gatewayReady={gatewayReady}
          onChange={(provider) => set({ provider, model: provider === "ai-gateway" ? GATEWAY_MODELS[0]?.id ?? null : null })}
        />
      </SettingRow>
      <SettingRow
        label="Model"
        sub={error ?? stat ?? (current.provider === "claude-cli"
          ? "CLI default keeps each step’s own model (Haiku for ads and metadata)."
          : "Steps that look at images (shots, sections, thumbnail) stay on the Claude CLI for now.")}
      >
        <ModelPicker label="Default model" provider={current.provider} value={current.model} onChange={(model) => set({ provider: current.provider, model })} />
      </SettingRow>
    </SettingsGroup>
  )
}

type StageProvider = "default" | AgentProvider

function StageRow({ stage, label, sub, own, route, gatewayReady, evals }: {
  readonly stage: AgentStage
  readonly label: string
  readonly sub: string
  readonly own: AgentChoice | null
  readonly route: AgentRoute
  readonly gatewayReady: boolean
  readonly evals: ReadonlyArray<ModelEval>
}) {
  const save = useAtomSet(setStageAgent, { mode: "promise" })
  const [error, setError] = useState<string | null>(null)
  const set = (agent: AgentChoice | null) =>
    void save({ payload: { stage, agent }, reactivityKeys: ["settings"] })
      .then(() => setError(null))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn’t save"))
  const cliOnly = CLI_ONLY_STAGES.includes(stage)
  const runsOn = `${providerName(route.provider)} · ${modelLabel(route.provider, route.model)}`
  const note = route.inherited
    ? route.forcedCli ? `Claude CLI only for now (it looks at images) · ${modelLabel("claude-cli", null)}` : `Uses the default: ${runsOn}`
    : `Its own choice: ${runsOn}`
  const stat = evalLine(evals, { provider: route.provider, model: route.model })

  return (
    <SettingRow label={label} sub={error ?? `${sub} ${note}.${stat === null ? "" : ` ${stat}`}`}>
      {own === null ? null : (
        <ModelPicker label={`${label} model`} provider={own.provider} value={own.model} onChange={(model) => set({ provider: own.provider, model })} />
      )}
      <Select<StageProvider>
        label={`${label} provider`}
        value={own === null ? "default" : own.provider}
        onChange={(next) => {
          if (next === "default") return set(null)
          set({ provider: next, model: next === "ai-gateway" ? GATEWAY_MODELS[0]?.id ?? null : null })
        }}
        options={[
          { value: "default", label: "Use default" },
          { value: "claude-cli", label: "Claude CLI" },
          ...(gatewayReady && !cliOnly ? [{ value: "ai-gateway" as const, label: "AI Gateway" }] : [])
        ]}
      />
    </SettingRow>
  )
}

function ProviderSelect({ label, value, gatewayReady, onChange }: {
  readonly label: string
  readonly value: AgentProvider
  readonly gatewayReady: boolean
  readonly onChange: (provider: AgentProvider) => void
}) {
  return (
    <Select<AgentProvider>
      label={label}
      value={value}
      onChange={onChange}
      options={[
        { value: "claude-cli", label: "Claude CLI" },
        // shown while chosen even without a key, so the page tells the truth
        ...(gatewayReady || value === "ai-gateway" ? [{ value: "ai-gateway" as const, label: "AI Gateway" }] : [])
      ]}
    />
  )
}

// A model for a provider: the known ones, or any other id typed in.
function ModelPicker({ label, provider, value, onChange }: {
  readonly label: string
  readonly provider: AgentProvider
  readonly value: string | null
  readonly onChange: (model: string | null) => void
}) {
  const known = provider === "claude-cli"
    ? CLI_MODELS.map((m) => ({ value: m.id ?? "default", label: m.label }))
    : GATEWAY_MODELS.map((m) => ({ value: m.id, label: m.label }))
  const selected = provider === "claude-cli" ? value ?? "default" : value ?? ""
  const isKnown = known.some((k) => k.value === selected)
  const [custom, setCustom] = useState<string | null>(isKnown ? null : value ?? "")
  const save = (next: string) => onChange(next.trim() === "" ? null : next.trim())

  return (
    <>
      {custom === null ? null : (
        <>
          <Input
            aria-label={`${label} id`}
            className="w-[220px]"
            value={custom}
            placeholder={provider === "claude-cli" ? "e.g. claude-opus-5-5" : "e.g. openai/gpt-6-luna"}
            onChange={(e) => setCustom(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && save(custom)}
          />
          <Button disabled={provider === "ai-gateway" && custom.trim() === ""} onClick={() => save(custom)}>Save</Button>
        </>
      )}
      <Select<string>
        label={label}
        className="min-w-[170px]"
        value={custom !== null ? "custom" : selected}
        onChange={(next) => {
          if (next === "custom") return setCustom(value ?? "")
          setCustom(null)
          onChange(next === "default" ? null : next)
        }}
        options={[...known, { value: "custom", label: provider === "claude-cli" ? "Other model id…" : "Other gateway id…" }]}
      />
    </>
  )
}

// Detailed mode: how each model did in your evals (cli eval), for choosing one.
function EvalsGroup({ evals }: { readonly evals: ReadonlyArray<ModelEval> }) {
  return (
    <SettingsGroup title="How models did in your evals">
      {evals.map((e) => (
        <Row key={`${e.provider}-${e.model}`} className="my-1 grid-cols-[minmax(0,1fr)_auto] bg-transparent px-0 hover:bg-transparent">
          <RowTitle title={evalLabel(e)} sub={`${providerName(e.provider)} · ${e.stages.join(", ")}`} />
          <span className="text-xs text-fg-1 tabular-nums">{evalLine([e], null) ?? ""}</span>
        </Row>
      ))}
    </SettingsGroup>
  )
}
