import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import {
  type AgentChoice,
  type AgentProvider,
  type AgentRoute,
  type AgentStage,
  type AppSettings,
  canRunStage,
  catalogFor,
  CLI_MODELS,
  type CliModels,
  isKeyProvider,
  type KeyModels,
  type KeyProvider,
  type ModelEval
} from "@viral/contracts"
import type { SelectOption } from "@viral/ui/primitives/select"
import { Button } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Row, RowTitle } from "@viral/ui/primitives/row"
import { Select } from "@viral/ui/primitives/select"
import { SettingRow, SettingsGroup } from "@viral/ui/primitives/setting-row"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useState } from "react"
import { modeAtom } from "../../system/preferences.ts"
import { accountsAtom, appSettingsAtom, cliModelsAtom, keyModelsAtom, modelEvalsAtom, setDefaultAgent, setStageAgent } from "../settings-api.ts"
import { Loaded, SettingsPage, SettingsSkeleton } from "../settings-page.tsx"
import {
  ACCOUNT_OF,
  API_KEYS,
  BILLED_TO,
  evalLabel,
  evalLine,
  keyModelOptions,
  modelLabel,
  PROVIDERS,
  providerName,
  SIGNED_IN
} from "./agents-values.ts"

// Each agent step, and what it does.
const STAGES: ReadonlyArray<{ readonly stage: AgentStage; readonly label: string; readonly sub: string }> = [
  { stage: "research", label: "Research", sub: "Searches YouTube for the videos a short from an idea needs, and proposes a shortlist." },
  { stage: "ads", label: "Ads", sub: "Finds sponsor reads, ads and end screens to keep out of shorts." },
  { stage: "story", label: "Story", sub: "Maps the long video's story and proposes three shorts." },
  { stage: "set-story", label: "Video set story", sub: "Looks across a set of videos and proposes three shorts that use them together." },
  { stage: "script", label: "Script", sub: "Writes the narration and picks the real lines." },
  { stage: "shots", label: "Shots", sub: "Looks at the video and picks the footage under each word." },
  { stage: "sections", label: "Sections", sub: "Picks the creator's best moments for a cut-down short." },
  { stage: "moments", label: "Ranking moments", sub: "Picks each video's before, care and after for a ranking, and ranks them." },
  { stage: "metadata", label: "Metadata", sub: "Writes the title, description and hashtags." },
  { stage: "thumbnail", label: "Thumbnail", sub: "Picks the hero, the face and the words for the thumbnail." }
]

// Which providers can be picked: the Claude CLI always; Codex and OpenCode once installed and signed in, a key
// provider once its key is saved (Settings › Accounts says how).
type Ready = Readonly<Record<AgentProvider, boolean>>

// A provider's first model to pick when it's chosen: a key provider starts on the catalog model recommended for the
// step (or for every step), OpenCode on its first model; Codex and the Claude CLI on their default.
const firstModel = (provider: AgentProvider, catalog: ReadonlyArray<CliModels>, stage: AgentStage | null) => {
  if (isKeyProvider(provider)) {
    const models = catalogFor(provider)
    return (models.find((m) => m.recommendedFor.includes(stage ?? "default")) ?? models[0])?.id ?? null
  }
  return provider === "opencode" ? catalog.find((c) => c.provider === "opencode")?.models[0]?.id ?? null : null
}

// Settings › Agents: who runs the agent steps and on which model. One default for every step, then any step
// can have its own choice. The Claude CLI is the default out of the box; Codex and OpenCode run on your own
// accounts there, and with your own API keys (Anthropic, OpenAI, Google Gemini, OpenRouter, the AI Gateway) their
// models run the text steps, billed to that account.
export function AgentsPage() {
  const settings = useAtomValue(appSettingsAtom)
  const accounts = useAtomValue(accountsAtom)
  const models = useAtomValue(cliModelsAtom)
  const evals = useAtomValue(modelEvalsAtom)
  const detailed = useAtomValue(modeAtom) === "detailed"
  const list = Option.getOrElse(AsyncResult.value(accounts), () => [])
  const isReady = (name: string) => list.some((a) => a.name === name && a.status === "ready")
  const ready = Object.fromEntries(PROVIDERS.map((p) => [p, p === "claude-cli" || isReady(ACCOUNT_OF[p])])) as Record<AgentProvider, boolean>
  const catalog = Option.getOrElse(AsyncResult.value(models), (): ReadonlyArray<CliModels> => [])
  const evalList = Option.getOrElse(AsyncResult.value(evals), (): ReadonlyArray<ModelEval> => [])

  return (
    <SettingsPage section="agents" description="Who runs each step, and on which model. Set a default for all steps, then change any step on its own.">
      <Loaded result={settings} what="your settings" skeleton={<SettingsSkeleton groups={[2, 7]} titled />}>
        {(value) => (
          <>
            <DefaultGroup settings={value} ready={ready} catalog={catalog} evals={evalList} detailed={detailed} />
            <SettingsGroup title="Each step">
              {STAGES.map((s) => (
                <StageRow
                  key={s.stage}
                  {...s}
                  own={value.stageAgents[s.stage]}
                  route={value.routes[s.stage]}
                  ready={ready}
                  catalog={catalog}
                  evals={evalList}
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

function DefaultGroup({ settings, ready, catalog, evals, detailed }: {
  readonly settings: AppSettings
  readonly ready: Ready
  readonly catalog: ReadonlyArray<CliModels>
  readonly evals: ReadonlyArray<ModelEval>
  readonly detailed: boolean
}) {
  const save = useAtomSet(setDefaultAgent, { mode: "promise" })
  const [error, setError] = useState<string | null>(null)
  const set = (agent: AgentChoice) =>
    void save({ payload: { agent }, reactivityKeys: ["settings"] })
      .then(() => setError(null))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn’t save"))
  const current = settings.defaultAgent
  const stat = detailed ? evalLine(evals, current) : null
  const billed = BILLED_TO[current.provider]
  const allReady = PROVIDERS.every((p) => ready[p])
  return (
    <SettingsGroup title="Default for all steps">
      <SettingRow
        label="Provider"
        sub={allReady
          ? "Who runs every step that hasn’t got its own choice."
          : <>Who runs every step. Apps and keys that aren’t set up yet are added in <Link to="/settings/accounts" className="underline">Accounts</Link>.</>}
      >
        <ProviderSelect label="Default provider" value={current.provider} ready={ready} onChange={(provider) => set({ provider, model: firstModel(provider, catalog, null) })} />
      </SettingRow>
      <SettingRow
        label="Model"
        sub={error ?? ([billed, stat].filter((x) => x !== undefined && x !== null).join(" · ") || (current.provider === "claude-cli"
          ? "CLI default keeps each step’s own model (Haiku for research, ads and metadata)."
          : "Steps that look at images (shots, sections, ranking moments, thumbnail) stay on the Claude CLI for now."))}
      >
        <ModelPicker
          label="Default model"
          provider={current.provider}
          stage={null}
          value={current.model}
          catalog={catalog}
          evals={evals}
          onChange={(model) => set({ provider: current.provider, model })}
        />
      </SettingRow>
    </SettingsGroup>
  )
}

type StageProvider = "default" | AgentProvider

function StageRow({ stage, label, sub, own, route, ready, catalog, evals }: {
  readonly stage: AgentStage
  readonly label: string
  readonly sub: string
  readonly own: AgentChoice | null
  readonly route: AgentRoute
  readonly ready: Ready
  readonly catalog: ReadonlyArray<CliModels>
  readonly evals: ReadonlyArray<ModelEval>
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
          stage={stage}
          value={own.model}
          catalog={catalog}
          evals={evals}
          onChange={(model) => set({ provider: own.provider, model })}
        />
      )}
      <Select<StageProvider>
        label={`${label} provider`}
        value={own === null ? "default" : own.provider}
        onChange={(next) => {
          if (next === "default") return set(null)
          set({ provider: next, model: firstModel(next, catalog, stage) })
        }}
        options={[
          { value: "default", label: "Use default" },
          // the image steps offer only providers that can see images in Viral (the Claude CLI, for now)
          ...providerOptions(ready, own?.provider ?? null).filter((o) => o.value === own?.provider || canRunStage(o.value, stage))
        ]}
      />
    </SettingRow>
  )
}

// The Provider menu: signed-in apps, then your API keys. One that isn't set up is greyed out with where to set it
// up; while chosen it stays pickable, so the page tells the truth.
const providerOptions = (ready: Ready, chosen: AgentProvider | null): ReadonlyArray<SelectOption<AgentProvider>> => {
  const option = (group: string) => (p: AgentProvider): SelectOption<AgentProvider> => ({
    value: p,
    label: providerName(p),
    group,
    ...(ready[p] || p === chosen ? {} : { disabled: true, note: isKeyProvider(p) ? "Add a key in Accounts" : "Set up in Accounts" })
  })
  return [...SIGNED_IN.map(option("Signed-in apps")), ...API_KEYS.map(option("Your API keys"))]
}

function ProviderSelect({ label, value, ready, onChange }: {
  readonly label: string
  readonly value: AgentProvider
  readonly ready: Ready
  readonly onChange: (provider: AgentProvider) => void
}) {
  return <Select<AgentProvider> label={label} className="min-w-[170px]" value={value} onChange={onChange} options={providerOptions(ready, value)} />
}

// The models offered for a provider: the Claude CLI's aliases, what Codex and OpenCode offer on your account, or a
// key provider's curated models and then the rest of your key's own list. "default" stands for the provider's own
// default.
const knownModels = (
  provider: AgentProvider,
  stage: AgentStage | null,
  catalog: ReadonlyArray<CliModels>,
  live: KeyModels | undefined,
  evals: ReadonlyArray<ModelEval>,
  value: string | null
): ReadonlyArray<SelectOption<string>> => {
  const account = (name: "codex" | "opencode") => catalog.find((c) => c.provider === name)?.models.map((m) => ({ value: m.id, label: m.label })) ?? []
  switch (provider) {
    case "claude-cli":
      return CLI_MODELS.map((m) => ({ value: m.id ?? "default", label: m.label }))
    case "codex":
      return [{ value: "default", label: "Codex default" }, ...account("codex")]
    case "opencode":
      return account("opencode")
    case "anthropic":
    case "openai":
    case "google":
    case "openrouter":
    case "ai-gateway":
      return keyModelOptions(provider, stage, live, evals, value).map((m) => ({
        value: m.value,
        label: m.label,
        ...(m.description === undefined ? {} : { description: m.description }),
        ...(m.note === undefined ? {} : { note: m.note }),
        ...(m.group === undefined ? {} : { group: m.group })
      }))
  }
}

// A model for a provider: the known ones, or any other id typed in.
function ModelPicker({ label, provider, stage, value, catalog, evals, onChange }: {
  readonly label: string
  readonly provider: AgentProvider
  readonly stage: AgentStage | null
  readonly value: string | null
  readonly catalog: ReadonlyArray<CliModels>
  readonly evals: ReadonlyArray<ModelEval>
  readonly onChange: (model: string | null) => void
}) {
  return isKeyProvider(provider)
    ? <KeyModelPicker label={label} provider={provider} stage={stage} value={value} catalog={catalog} evals={evals} onChange={onChange} />
    : <ModelChooser label={label} provider={provider} value={value} known={knownModels(provider, stage, catalog, undefined, evals, value)} onChange={onChange} />
}

function KeyModelPicker({ label, provider, stage, value, catalog, evals, onChange }: {
  readonly label: string
  readonly provider: KeyProvider
  readonly stage: AgentStage | null
  readonly value: string | null
  readonly catalog: ReadonlyArray<CliModels>
  readonly evals: ReadonlyArray<ModelEval>
  readonly onChange: (model: string | null) => void
}) {
  // the vendor's own list from your key, read only while this provider is shown
  const live = Option.getOrUndefined(AsyncResult.value(useAtomValue(keyModelsAtom(provider))))
  return <ModelChooser label={label} provider={provider} value={value} known={knownModels(provider, stage, catalog, live, evals, value)} onChange={onChange} />
}

function ModelChooser({ label, provider, value, known, onChange }: {
  readonly label: string
  readonly provider: AgentProvider
  readonly value: string | null
  readonly known: ReadonlyArray<SelectOption<string>>
  readonly onChange: (model: string | null) => void
}) {
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
        options={[...known, { value: "custom", label: "Other model…" }]}
      />
    </>
  )
}

const PLACEHOLDER: Record<AgentProvider, string> = {
  "claude-cli": "e.g. claude-opus-5-5",
  codex: "e.g. gpt-6-astra",
  opencode: "e.g. anthropic/claude-haiku-5.5",
  anthropic: "e.g. claude-haiku-5-5",
  openai: "e.g. gpt-6-luna",
  google: "e.g. gemini-3.8-flash",
  openrouter: "e.g. anthropic/claude-haiku-5.5",
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
