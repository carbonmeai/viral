import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import {
  type AgentChoice,
  type AgentProvider,
  type AgentRoute,
  type AgentStage,
  type AppSettings,
  canRunStage,
  CLI_MODELS,
  type CliModels,
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
import { accountsAtom, appSettingsAtom, cliModelsAtom, modelEvalsAtom, setDefaultAgent, setStageAgent } from "../settings-api.ts"
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

// Which providers can be picked: the Claude CLI always; Codex and OpenCode once installed and signed in (Settings ›
// Accounts says how); the gateway with a key.
type Ready = Readonly<Record<AgentProvider, boolean>>

// A provider's first model to pick when it's chosen: the gateway and OpenCode need one, Codex and the Claude CLI
// start on their default.
const firstModel = (provider: AgentProvider, catalog: ReadonlyArray<CliModels>) =>
  provider === "ai-gateway"
    ? GATEWAY_MODELS[0]?.id ?? null
    : provider === "opencode"
    ? catalog.find((c) => c.provider === "opencode")?.models[0]?.id ?? null
    : null

// Settings › Agents: who runs the agent steps and on which model. One default for every step, then any step
// can have its own choice. The Claude CLI is the default out of the box; Codex and OpenCode run on your own
// accounts there, and with an AI Gateway key other models (Haiku 5.5, GPT-6 Luna, Gemini…) can run the text steps.
export function AgentsPage() {
  const settings = useAtomValue(appSettingsAtom)
  const accounts = useAtomValue(accountsAtom)
  const models = useAtomValue(cliModelsAtom)
  const evals = useAtomValue(modelEvalsAtom)
  const detailed = useAtomValue(modeAtom) === "detailed"
  const list = Option.getOrElse(AsyncResult.value(accounts), () => [])
  const isReady = (name: string) => list.some((a) => a.name === name && a.status === "ready")
  const ready: Ready = { "claude-cli": true, codex: isReady("codex"), opencode: isReady("opencode"), "ai-gateway": isReady("gateway") }
  const catalog = Option.getOrElse(AsyncResult.value(models), (): ReadonlyArray<CliModels> => [])
  const evalList = Option.getOrElse(AsyncResult.value(evals), (): ReadonlyArray<ModelEval> => [])

  return (
    <SettingsPage section="agents" description="Who runs each step, and on which model. Set a default for all steps, then change any step on its own.">
      <Loaded result={settings} what="your settings" skeleton={<SettingsSkeleton groups={[2, 7]} titled />}>
        {(value) => (
          <>
            <DefaultGroup settings={value} ready={ready} catalog={catalog} evals={detailed ? evalList : []} />
            <SettingsGroup title="Each step">
              {STAGES.map((s) => (
                <StageRow
                  key={s.stage}
                  {...s}
                  own={value.stageAgents[s.stage]}
                  route={value.routes[s.stage]}
                  ready={ready}
                  catalog={catalog}
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

function DefaultGroup({ settings, ready, catalog, evals }: {
  readonly settings: AppSettings
  readonly ready: Ready
  readonly catalog: ReadonlyArray<CliModels>
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
        sub={ready.codex && ready.opencode && ready["ai-gateway"]
          ? "Who runs every step that hasn’t got its own choice."
          : <>Who runs every step. Codex, OpenCode and the AI Gateway appear once they’re set up in <Link to="/settings/accounts" className="underline">Accounts</Link>.</>}
      >
        <ProviderSelect label="Default provider" value={current.provider} ready={ready} onChange={(provider) => set({ provider, model: firstModel(provider, catalog) })} />
      </SettingRow>
      <SettingRow
        label="Model"
        sub={error ?? stat ?? (current.provider === "claude-cli"
          ? "CLI default keeps each step’s own model (Haiku for ads and metadata)."
          : "Steps that look at images (shots, sections, thumbnail) stay on the Claude CLI for now.")}
      >
        <ModelPicker
          label="Default model"
          provider={current.provider}
          value={current.model}
          catalog={catalog}
          onChange={(model) => set({ provider: current.provider, model })}
        />
      </SettingRow>
    </SettingsGroup>
  )
}

type StageProvider = "default" | AgentProvider

function StageRow({ stage, label, sub, own, route, ready, catalog }: {
  readonly stage: AgentStage
  readonly label: string
  readonly sub: string
  readonly own: AgentChoice | null
  readonly route: AgentRoute
  readonly ready: Ready
  readonly catalog: ReadonlyArray<CliModels>
}) {
  const save = useAtomSet(setStageAgent, { mode: "promise" })
  const [error, setError] = useState<string | null>(null)
  const set = (agent: AgentChoice | null) =>
    void save({ payload: { stage, agent }, reactivityKeys: ["settings"] })
      .then(() => setError(null))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn’t save"))
  const runsOn = `${providerName(route.provider)} · ${modelLabel(route.provider, route.model, catalog)}`
  const note = route.inherited
    ? route.forcedCli ? `Claude CLI only for now (it looks at images) · ${modelLabel("claude-cli", null)}` : `Uses the default: ${runsOn}`
    : `Its own choice: ${runsOn}`

  return (
    <SettingRow label={label} sub={error ?? `${sub} ${note}.`}>
      {own === null ? null : (
        <ModelPicker
          label={`${label} model`}
          provider={own.provider}
          value={own.model}
          catalog={catalog}
          onChange={(model) => set({ provider: own.provider, model })}
        />
      )}
      <Select<StageProvider>
        label={`${label} provider`}
        value={own === null ? "default" : own.provider}
        onChange={(next) => {
          if (next === "default") return set(null)
          set({ provider: next, model: firstModel(next, catalog) })
        }}
        options={[
          { value: "default", label: "Use default" },
          ...PROVIDERS.filter((p) => (ready[p] && canRunStage(p, stage)) || own?.provider === p)
            .map((p) => ({ value: p, label: providerName(p) }))
        ]}
      />
    </SettingRow>
  )
}

const PROVIDERS: ReadonlyArray<AgentProvider> = ["claude-cli", "codex", "opencode", "ai-gateway"]

function ProviderSelect({ label, value, ready, onChange }: {
  readonly label: string
  readonly value: AgentProvider
  readonly ready: Ready
  readonly onChange: (provider: AgentProvider) => void
}) {
  return (
    <Select<AgentProvider>
      label={label}
      value={value}
      onChange={onChange}
      // one that isn't set up is still shown while chosen, so the page tells the truth
      options={PROVIDERS.filter((p) => ready[p] || p === value).map((p) => ({ value: p, label: providerName(p) }))}
    />
  )
}

// The models offered for a provider: the Claude CLI's aliases, the gateway's list, or what Codex and OpenCode offer
// on your account. "default" stands for the provider's own default.
const knownModels = (provider: AgentProvider, catalog: ReadonlyArray<CliModels>) => {
  const account = (name: "codex" | "opencode") => catalog.find((c) => c.provider === name)?.models.map((m) => ({ value: m.id, label: m.label })) ?? []
  switch (provider) {
    case "claude-cli":
      return CLI_MODELS.map((m) => ({ value: m.id ?? "default", label: m.label }))
    case "codex":
      return [{ value: "default", label: "Codex default" }, ...account("codex")]
    case "opencode":
      return account("opencode")
    case "ai-gateway":
      return GATEWAY_MODELS.map((m) => ({ value: m.id, label: m.label }))
  }
}

// A model for a provider: the known ones, or any other id typed in.
function ModelPicker({ label, provider, value, catalog, onChange }: {
  readonly label: string
  readonly provider: AgentProvider
  readonly value: string | null
  readonly catalog: ReadonlyArray<CliModels>
  readonly onChange: (model: string | null) => void
}) {
  const known = knownModels(provider, catalog)
  const hasDefault = provider === "claude-cli" || provider === "codex"
  const selected = hasDefault ? value ?? "default" : value ?? ""
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
            placeholder={PLACEHOLDER[provider]}
            onChange={(e) => setCustom(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && save(custom)}
          />
          <Button disabled={!hasDefault && custom.trim() === ""} onClick={() => save(custom)}>Save</Button>
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
        options={[...known, { value: "custom", label: provider === "ai-gateway" ? "Other gateway id…" : "Other model id…" }]}
      />
    </>
  )
}

const PLACEHOLDER: Record<AgentProvider, string> = {
  "claude-cli": "e.g. claude-opus-5-5",
  codex: "e.g. gpt-6-astra",
  opencode: "e.g. anthropic/claude-haiku-5.5",
  "ai-gateway": "e.g. openai/gpt-6-luna"
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
