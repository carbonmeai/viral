import { type AgentChoice, type AgentProvider, CLI_MODELS, type CliModels, GATEWAY_MODELS, type ModelEval } from "@viral/contracts"

const NAMES: Record<AgentProvider, string> = {
  "claude-cli": "Claude CLI",
  codex: "Codex",
  opencode: "OpenCode",
  "ai-gateway": "AI Gateway"
}
export const providerName = (provider: AgentProvider) => NAMES[provider]

// A model as people say it: "CLI default", "Opus", "Claude Haiku 5.5", "GPT-6 Astra", or the id typed in. Codex
// and OpenCode name their models from your account's catalog (`catalog`).
export const modelLabel = (provider: AgentProvider, model: string | null, catalog: ReadonlyArray<CliModels> = []) => {
  switch (provider) {
    case "claude-cli":
      return CLI_MODELS.find((m) => m.id === model)?.label ?? model ?? "CLI default"
    case "ai-gateway":
      return GATEWAY_MODELS.find((m) => m.id === model)?.label ?? model ?? "no model chosen"
    case "codex":
      return catalog.find((c) => c.provider === "codex")?.models.find((m) => m.id === model)?.label ?? model ?? "Codex default"
    case "opencode":
      return model ?? "no model chosen"
  }
}

// How an eval names a model: claude-cli (the step's own CLI model), claude-cli:<model>, codex, codex:<model>,
// opencode:<provider/model>, or a gateway id.
export const evalKey = (choice: AgentChoice) => {
  switch (choice.provider) {
    case "claude-cli":
    case "codex":
      return choice.model === null ? choice.provider : `${choice.provider}:${choice.model}`
    case "opencode":
      return `opencode:${choice.model ?? ""}`
    case "ai-gateway":
      return choice.model ?? ""
  }
}

const withoutPrefix = (key: string, provider: string) => key.startsWith(`${provider}:`) ? key.slice(provider.length + 1) : null

export const evalLabel = (e: ModelEval) => {
  switch (e.provider) {
    case "claude-cli":
      return e.model === "claude-cli" ? "Claude CLI (each step’s default)" : `Claude CLI · ${modelLabel("claude-cli", withoutPrefix(e.model, "claude-cli"))}`
    case "codex":
      return e.model === "codex" ? "Codex (its default model)" : `Codex · ${withoutPrefix(e.model, "codex") ?? e.model}`
    case "opencode":
      return `OpenCode · ${withoutPrefix(e.model, "opencode") ?? e.model}`
    case "ai-gateway":
      return modelLabel("ai-gateway", e.model)
  }
}

const usd = (n: number) => n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`

// One line on how a model did in your evals: "Evals: 8/8 passed · 6/8 first try · $0.0048 a run". Codex on a
// ChatGPT plan reports no dollars, so its runs say "on your plan". With no choice, the first model's.
export const evalLine = (evals: ReadonlyArray<ModelEval>, choice: AgentChoice | null): string | null => {
  const e = choice === null ? evals[0] : evals.find((x) => x.provider === choice.provider && x.model === evalKey(choice))
  if (e === undefined) return null
  const cost = e.provider === "codex" ? "on your plan" : `${usd(e.avgCostUsd)} a run`
  return `Evals: ${e.passed}/${e.runs} passed · ${e.firstTryPassed}/${e.runs} first try · ${cost}`
}
