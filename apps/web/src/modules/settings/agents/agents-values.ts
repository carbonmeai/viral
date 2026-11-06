import { type AgentChoice, type AgentProvider, CLI_MODELS, GATEWAY_MODELS, type ModelEval } from "@viral/contracts"

export const providerName = (provider: AgentProvider) => provider === "claude-cli" ? "Claude CLI" : "AI Gateway"

// A model as people say it: "CLI default", "Opus", "Claude Haiku 5.5", or the id typed in.
export const modelLabel = (provider: AgentProvider, model: string | null) =>
  provider === "claude-cli"
    ? CLI_MODELS.find((m) => m.id === model)?.label ?? model ?? "CLI default"
    : GATEWAY_MODELS.find((m) => m.id === model)?.label ?? model ?? "no model chosen"

// How an eval names a model: claude-cli (the step's own CLI model), claude-cli:<model>, or a gateway id.
export const evalKey = (choice: AgentChoice) =>
  choice.provider === "claude-cli" ? (choice.model === null ? "claude-cli" : `claude-cli:${choice.model}`) : choice.model ?? ""

export const evalLabel = (e: ModelEval) =>
  e.provider === "claude-cli"
    ? e.model === "claude-cli" ? "Claude CLI (each step’s default)" : `Claude CLI · ${modelLabel("claude-cli", e.model.slice("claude-cli:".length))}`
    : modelLabel("ai-gateway", e.model)

const usd = (n: number) => n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`

// One line on how a model did in your evals: "Evals: 8/8 passed · 6/8 first try · $0.0048 a run". With no choice,
// the first model's.
export const evalLine = (evals: ReadonlyArray<ModelEval>, choice: AgentChoice | null): string | null => {
  const e = choice === null ? evals[0] : evals.find((x) => x.provider === choice.provider && x.model === evalKey(choice))
  if (e === undefined) return null
  return `Evals: ${e.passed}/${e.runs} passed · ${e.firstTryPassed}/${e.runs} first try · ${usd(e.avgCostUsd)} a run`
}
