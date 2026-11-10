import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import {
  type AgentChoice,
  type AgentProvider,
  type AgentRoute,
  type AgentStage,
  type AppSettings,
  catalogFor,
  type CliModels,
  isKeyProvider,
  type KeyModels,
  type KeyProvider,
  type ModelEval,
  seesImages
} from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import { Picker, type PickerOption } from "@viral/ui/primitives/picker"
import { Button } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { Row, RowTitle } from "@viral/ui/primitives/row"
import { SettingRow, SettingsGroup } from "@viral/ui/primitives/setting-row"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { RotateCcw } from "lucide-react"
import { useState } from "react"
import { modeAtom } from "../../system/preferences.ts"
import { accountsAtom, appSettingsAtom, cliModelsAtom, keyModelsAtom, modelEvalsAtom, setDefaultAgent, setStageAgent } from "../settings-api.ts"
import { Loaded, SettingsPage, SettingsSkeleton } from "../settings-page.tsx"
import {
  ACCOUNT_OF,
  BILLED_TO,
  cliModelChoices,
  evalLabel,
  evalLine,
  isVisionStage,
  keyModelOptions,
  modelLabel,
  type ModelOption,
  providerChoices,
  PROVIDERS,
  providerName
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
// step (or for every step), OpenCode on its first model; Codex and the Claude CLI on their default. An image step
// only starts on a model that sees images.
const firstModel = (provider: AgentProvider, catalog: ReadonlyArray<CliModels>, stage: AgentStage | null) => {
  if (isKeyProvider(provider)) {
    const models = catalogFor(provider).filter((m) => !isVisionStage(stage) || m.badges.includes("vision"))
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
                  defaultRoute={value.defaultAgent}
                  route={value.routes[s.stage]}
                  seen={value.visionModels}
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
        <ProviderPicker<AgentProvider> label="Default provider" value={current.provider} ready={ready} evals={evals} onChange={(provider) => set({ provider, model: firstModel(provider, catalog, null) })} />
      </SettingRow>
      <SettingRow
        label="Model"
        sub={error ?? ([
          billed,
          stat,
          // a default that can't see images leaves the image steps on the Claude CLI; say so
          current.provider === "claude-cli" || seesImages(current, settings.visionModels)
            ? null
            : "Doesn’t take images, so the steps that look at them (shots, sections, ranking moments, thumbnail) run on the Claude CLI"
        ].filter((x) => x !== undefined && x !== null).join(" · ") || (current.provider === "claude-cli"
          ? "CLI default keeps each step’s own model (Haiku for research, ads and metadata)."
          : "Runs every step, including the ones that look at images."))}
      >
        <ModelPicker
          label="Default model"
          provider={current.provider}
          stage={null}
          value={current.model}
          seen={settings.visionModels}
          catalog={catalog}
          evals={evals}
          onChange={(model) => set({ provider: current.provider, model })}
        />
      </SettingRow>
    </SettingsGroup>
  )
}


function StageRow({ stage, label, sub, own, defaultRoute, route, seen, ready, catalog, evals }: {
  readonly stage: AgentStage
  readonly label: string
  readonly sub: string
  readonly own: AgentChoice | null
  readonly defaultRoute: AgentChoice
  readonly route: AgentRoute
  readonly seen: ReadonlyArray<string>
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
  const note = route.forcedCli
    ? `It looks at images, which ${route.inherited ? "the default" : "its choice"} doesn’t take, so it runs on the Claude CLI · ${modelLabel("claude-cli", null)}`
    : route.inherited
    ? `Uses the default: ${runsOn}`
    : `Its own choice: ${runsOn}`

  return (
    <SettingRow label={label} sub={error ?? `${sub} ${note}.`}>
      {own === null ? null : (
        <ModelPicker
          label={`${label} model`}
          provider={own.provider}
          stage={stage}
          value={own.model}
          seen={seen}
          catalog={catalog}
          evals={evals}
          onChange={(model) => set({ provider: own.provider, model })}
        />
      )}
      <ProviderPicker
        label={`${label} provider`}
        value={own === null ? "default" : own.provider}
        ready={ready}
        vision={isVisionStage(stage)}
        evals={evals}
        useDefault={`${providerName(defaultRoute.provider)} · ${modelLabel(defaultRoute.provider, defaultRoute.model, catalog)}, as set in “Default for all steps”.`}
        onChange={(next) => {
          if (next === "default") return set(null)
          set({ provider: next, model: firstModel(next, catalog, stage) })
        }}
      />
    </SettingRow>
  )
}

// The Provider picker: your plans, then pay per run, then this Mac, each saying who pays and what it can do (greyed
// out with where to set it up when it isn't; on an image step, Codex and OpenCode too). A step's picker starts with
// "Use default".
export function ProviderPicker<V extends AgentProvider | "default">({ label, value, ready, vision = false, evals = [], useDefault, onChange, className, display }: {
  readonly label: string
  // what the button says, when not just the provider's name (a generator's Model row names the model too)
  readonly display?: string
  readonly value: V
  readonly ready: Ready
  readonly vision?: boolean
  readonly evals?: ReadonlyArray<ModelEval>
  // the line under "Use default" (what the default runs on); left out, there's no such choice
  readonly useDefault?: string
  readonly onChange: (provider: V) => void
  readonly className?: string
}) {
  const detailed = useAtomValue(modeAtom) === "detailed"
  const chosen = value === "default" ? null : value as AgentProvider
  const options: Array<PickerOption<V>> = [
    ...(useDefault === undefined ? [] : [{ value: "default" as V, label: "Use default", description: useDefault, mark: <RotateCcw />, keywords: "default" }]),
    ...providerChoices(ready, chosen, vision, evals, detailed).map((c): PickerOption<V> => ({
      value: c.value as V,
      label: c.label,
      description: c.description,
      badges: c.badges,
      ...(c.note === undefined ? {} : { note: c.note }),
      ...(c.detail === undefined ? {} : { detail: c.detail }),
      disabled: c.disabled,
      group: c.group,
      mark: c.mark
    }))
  ]
  return <Picker<V> label={label} className={cn("min-w-[170px]", className)} value={value} onChange={onChange} options={options} placeholder="Search providers…" {...(display === undefined ? {} : { display })} />
}

// The models offered for a provider: the Claude CLI's aliases, what Codex and OpenCode offer on your account, or a
// key provider's curated models and then the rest of your key's own list. "default" stands for the provider's own
// default. Each says what it's good for, with badges and what a run costs (Detailed adds how it did in your evals).
const knownModels = (
  provider: AgentProvider,
  stage: AgentStage | null,
  catalog: ReadonlyArray<CliModels>,
  live: KeyModels | undefined,
  evals: ReadonlyArray<ModelEval>,
  value: string | null,
  seen: ReadonlyArray<string>,
  detailed: boolean
): ReadonlyArray<PickerOption<string>> => {
  const toOption = (m: ModelOption & { readonly detail?: string | undefined }): PickerOption<string> => ({
    value: m.value,
    label: m.label,
    badges: m.badges,
    keywords: m.value,
    ...(m.disabled === true ? { disabled: true } : {}),
    ...(m.description === undefined ? {} : { description: m.description }),
    ...(m.note === undefined ? {} : { note: m.note }),
    ...(m.group === undefined ? {} : { group: m.group }),
    ...(m.detail === undefined ? {} : { detail: m.detail })
  })
  switch (provider) {
    case "claude-cli":
    case "codex":
      return cliModelChoices(provider, catalog, evals, detailed).map(toOption)
    case "opencode":
      return (catalog.find((c) => c.provider === "opencode")?.models ?? []).map((m) => ({ value: m.id, label: m.label, keywords: m.id, group: "Set up in OpenCode" }))
    case "anthropic":
    case "openai":
    case "google":
    case "openrouter":
    case "ai-gateway":
      return keyModelOptions(provider, stage, live, evals, value, seen).map((m) =>
        toOption({ ...m, detail: detailed ? evalLine(evals, { provider, model: m.value }) ?? undefined : undefined })
      )
  }
}

// A model for a provider: the known ones, or any other id typed in.
function ModelPicker({ label, provider, stage, value, seen, catalog, evals, onChange }: {
  readonly label: string
  readonly provider: AgentProvider
  readonly stage: AgentStage | null
  readonly value: string | null
  readonly seen: ReadonlyArray<string>
  readonly catalog: ReadonlyArray<CliModels>
  readonly evals: ReadonlyArray<ModelEval>
  readonly onChange: (model: string | null) => void
}) {
  const detailed = useAtomValue(modeAtom) === "detailed"
  return isKeyProvider(provider)
    ? <KeyModelPicker label={label} provider={provider} stage={stage} value={value} seen={seen} catalog={catalog} evals={evals} onChange={onChange} />
    : <ModelChooser label={label} provider={provider} value={value} known={knownModels(provider, stage, catalog, undefined, evals, value, seen, detailed)} onChange={onChange} />
}

function KeyModelPicker({ label, provider, stage, value, seen, catalog, evals, onChange }: {
  readonly label: string
  readonly provider: KeyProvider
  readonly stage: AgentStage | null
  readonly value: string | null
  readonly seen: ReadonlyArray<string>
  readonly catalog: ReadonlyArray<CliModels>
  readonly evals: ReadonlyArray<ModelEval>
  readonly onChange: (model: string | null) => void
}) {
  // the vendor's own list from your key, read only while this provider is shown
  const live = Option.getOrUndefined(AsyncResult.value(useAtomValue(keyModelsAtom(provider))))
  const detailed = useAtomValue(modeAtom) === "detailed"
  return <ModelChooser label={label} provider={provider} value={value} known={knownModels(provider, stage, catalog, live, evals, value, seen, detailed)} onChange={onChange} />
}

function ModelChooser({ label, provider, value, known, onChange }: {
  readonly label: string
  readonly provider: AgentProvider
  readonly value: string | null
  readonly known: ReadonlyArray<PickerOption<string>>
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
      <Picker<string>
        label={label}
        className="min-w-[170px]"
        value={custom !== null ? "custom" : selected}
        display={custom !== null ? "Other model…" : known.find((k) => k.value === selected)?.label ?? (selected === "" ? "Choose a model" : selected)}
        onChange={(next) => {
          if (next === "custom") return setCustom(value ?? "")
          setCustom(null)
          onChange(next === "default" ? null : next)
        }}
        placeholder="Search models…"
        options={[...known, { value: "custom", label: "Other model…", description: "Type any model id", keywords: "custom id type" }]}
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
