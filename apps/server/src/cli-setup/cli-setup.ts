import { NodeServices } from "@effect/platform-node"
import {
  CLI_PRESETS,
  type CliEnvVar,
  CliName,
  CliPreset,
  type CliSetup,
  envNameProblem,
  type KeyName,
  OPENROUTER_ANTHROPIC_URL,
  SettingsError
} from "@viral/contracts"
import type { CliEnvironment } from "@viral/provider-core"
import { Config, Context, Effect, Layer, Option, Path, Redacted, Schema } from "effect"
import { AgentError } from "../agent-session/agent-task.ts"
import { ViralHome } from "../home/viral-home.ts"
import { lastFour, Secrets } from "../secrets/secrets.ts"
import { Settings } from "../settings/settings.ts"

// A CLI's own variable as kept in settings: a plain value, or (secret) only its name, the value being in the
// secret store under `cli.<cli>.env.<NAME>`.
const StoredVar = Schema.Struct({ name: Schema.String, value: Schema.NullOr(Schema.String), secret: Schema.Boolean })
type StoredVar = typeof StoredVar.Type

export const presetKey = (cli: CliName) => `cli.${cli}.preset`
export const envKey = (cli: CliName) => `cli.${cli}.env`
export const secretAccount = (cli: CliName, name: string) => `cli.${cli}.env.${name}`

// Who a CLI is to its provider name, and back.
export const CLI_OF = { "claude-cli": "claude", codex: "codex", opencode: "opencode" } as const
export type CliProvider = keyof typeof CLI_OF

const KEY_LABEL: Record<KeyName, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
  openrouter: "OpenRouter",
  gateway: "AI Gateway",
  elevenlabs: "ElevenLabs",
  xai: "xAI"
}

// The variables OpenCode reads for each key it can be handed (Google's is the AI SDK's name, which OpenCode uses).
export const OPENCODE_KEY_VARS = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  openrouter: "OPENROUTER_API_KEY"
} as const satisfies Partial<Record<KeyName, string>>
const SHARED_KEYS = Object.keys(OPENCODE_KEY_VARS) as Array<keyof typeof OPENCODE_KEY_VARS>

const CLI_LABEL: Record<CliName, string> = { claude: "The Claude CLI", codex: "Codex", opencode: "OpenCode" }

const nonEmpty = (value: string | undefined | null) => value !== undefined && value !== null && value.trim() !== ""

// One run's setup for a CLI: what goes to its process, what its runs count as, and whether their reported cost is
// only an estimate (the Claude CLI through a router prices every model at Anthropic's rates).
export interface CliRun {
  readonly environment: CliEnvironment
  readonly billing: "billed" | "subscription"
  readonly costBasis: "estimate" | null
}

// Each signed-in CLI's key setup (Settings › Accounts): on your sign-in as usual, or on a preset that reuses a key
// saved in Model keys, plus your own environment variables (a secret one's value lives in the secret store). Nothing
// here goes into the server's own environment: a run's variables are resolved for that run and handed only to its
// process. A preset that needs its own config folder gets one under ~/.viral/cli/, so your normal login isn't used
// or changed.
export class CliSetups extends Context.Service<CliSetups, {
  readonly all: Effect.Effect<ReadonlyArray<CliSetup>>
  get(cli: CliName): Effect.Effect<CliSetup>
  setPreset(cli: CliName, preset: CliPreset | null): Effect.Effect<CliSetup, SettingsError>
  setVar(cli: CliName, name: string, value: string, secret: boolean): Effect.Effect<CliSetup, SettingsError>
  removeVar(cli: CliName, name: string): Effect.Effect<CliSetup, SettingsError>
  // what a run on this CLI gets; fails when its preset's key or a secret variable is missing
  resolve(provider: CliProvider): Effect.Effect<CliRun, AgentError>
}>()("@viral/server/cli-setup/cli-setup/CliSetups") {
  static readonly make = Effect.gen(function*() {
    const settings = yield* Settings
    const secrets = yield* Secrets
    const home = yield* ViralHome
    const path = yield* Path.Path
    // the server's own Anthropic variables, which the Claude CLI inherits unless a run's variables replace them
    const serverEnv = {
      ANTHROPIC_API_KEY: Option.getOrUndefined(yield* Config.option(Config.String("ANTHROPIC_API_KEY")).pipe(Effect.orDie)),
      ANTHROPIC_AUTH_TOKEN: Option.getOrUndefined(yield* Config.option(Config.String("ANTHROPIC_AUTH_TOKEN")).pipe(Effect.orDie)),
      ANTHROPIC_BASE_URL: Option.getOrUndefined(yield* Config.option(Config.String("ANTHROPIC_BASE_URL")).pipe(Effect.orDie))
    }

    const configDir = (preset: CliPreset) => path.join(home.root, "cli", preset)

    const presetOf = (cli: CliName) =>
      settings.get(presetKey(cli), CliPreset).pipe(
        // a preset is only ever one of the CLI's own
        Effect.map(Option.filter((preset) => CLI_PRESETS[preset].cli === cli)),
        Effect.map(Option.getOrNull)
      )
    const varsOf = (cli: CliName) =>
      settings.get(envKey(cli), Schema.Array(StoredVar)).pipe(Effect.map(Option.getOrElse((): ReadonlyArray<StoredVar> => [])))

    // a saved key's value (the environment's wins, as everywhere), or none
    const keyValue = (name: KeyName) => secrets.get(name)
    const keyWords = Effect.fn("CliSetups.keyWords")(function*(name: KeyName) {
      const info = yield* secrets.info(name)
      if (Option.isNone(info.source)) return `your ${KEY_LABEL[name]} key (not saved)`
      return `your ${KEY_LABEL[name]} key${info.last4 === null ? "" : ` …${info.last4}`}`
    })
    const hasKey = (name: KeyName) => Effect.map(secrets.info(name), (info) => Option.isSome(info.source))

    // The preset's variables in words (Settings), and its missing keys.
    const describePreset = Effect.fn("CliSetups.describePreset")(function*(preset: CliPreset) {
      switch (preset) {
        case "claude-openrouter":
          return [
            { name: "ANTHROPIC_BASE_URL", value: OPENROUTER_ANTHROPIC_URL },
            { name: "ANTHROPIC_AUTH_TOKEN", value: yield* keyWords("openrouter") },
            { name: "ANTHROPIC_API_KEY", value: "(empty)" },
            { name: "CLAUDE_CONFIG_DIR", value: configDir(preset) }
          ]
        case "claude-anthropic":
          return [{ name: "ANTHROPIC_API_KEY", value: yield* keyWords("anthropic") }]
        case "codex-openai":
          return [
            { name: "Sign-in", value: `${yield* keyWords("openai")}, kept in memory only` },
            { name: "CODEX_HOME", value: configDir(preset) }
          ]
        case "opencode-keys":
          return yield* Effect.forEach(SHARED_KEYS, (key) =>
            Effect.map(keyWords(key), (value) => ({ name: OPENCODE_KEY_VARS[key], value })))
      }
    })

    const problemOf = Effect.fn("CliSetups.problemOf")(function*(cli: CliName, preset: CliPreset | null, vars: ReadonlyArray<StoredVar>) {
      if (preset !== null) {
        const info = CLI_PRESETS[preset]
        const present = yield* Effect.forEach(info.keys, hasKey)
        if (preset === "opencode-keys" && !present.some(Boolean)) {
          return "None of your Anthropic, OpenAI, Google or OpenRouter keys is saved, so there's nothing to share."
        }
        if (preset !== "opencode-keys" && present.some((ok) => !ok)) {
          return `Add your ${info.keys.map((k) => KEY_LABEL[k]).join(" and ")} key in Model keys first, or switch back to your sign-in.`
        }
      }
      for (const v of vars) {
        if (v.secret && Option.isNone(yield* secrets.readStored(secretAccount(cli, v.name)))) {
          return `${v.name}'s secret value is missing from the Keychain. Set it again.`
        }
      }
      return null
    })

    // What a run's environment looks like, from the stored variables and the preset (whose variables win), with
    // secrets read through `secretValue`. Shared by the view (which never reads a value) and a run.
    const claudeBilling = (env: Readonly<Record<string, string>>) => {
      const effective = { ...serverEnv, ...env }
      return nonEmpty(effective.ANTHROPIC_API_KEY) || nonEmpty(effective.ANTHROPIC_AUTH_TOKEN) ? "billed" as const : "subscription" as const
    }

    const get = Effect.fn("CliSetups.get")(function*(cli: CliName) {
      const preset = yield* presetOf(cli)
      const vars = yield* varsOf(cli)
      const env = yield* Effect.forEach(vars, (v): Effect.Effect<CliEnvVar> =>
        v.secret
          ? Effect.map(secrets.readStored(secretAccount(cli, v.name)), (value): CliEnvVar => ({
            name: v.name,
            value: null,
            secret: true,
            last4: Option.match(value, { onNone: () => null, onSome: (r) => lastFour(Redacted.value(r)) })
          }))
          : Effect.succeed<CliEnvVar>({ name: v.name, value: v.value ?? "", secret: false, last4: null }))
      // a secret counts as set; billing reads only whether a value is there, never the value
      const shape = Object.fromEntries(vars.map((v) => [v.name, v.secret ? "(secret)" : v.value ?? ""]))
      const presetShape: Record<string, string> = preset === "claude-openrouter"
        ? { ANTHROPIC_AUTH_TOKEN: "(key)", ANTHROPIC_API_KEY: "" }
        : preset === "claude-anthropic"
        ? { ANTHROPIC_API_KEY: "(key)" }
        : {}
      const billing = cli === "claude"
        ? claudeBilling({ ...shape, ...presetShape })
        : cli === "codex"
        ? preset === "codex-openai" ? "billed" as const : "subscription" as const
        : "billed" as const
      return {
        cli,
        preset,
        presetVars: preset === null ? [] : yield* describePreset(preset),
        env,
        configDir: preset === "claude-openrouter" || preset === "codex-openai" ? configDir(preset) : null,
        billing,
        using: preset === null ? null : preset === "opencode-keys" ? "Sharing your model keys" : `Using your ${CLI_PRESETS[preset].label}`,
        problem: yield* problemOf(cli, preset, vars)
      } satisfies CliSetup
    })

    const all = Effect.forEach(CliName.literals, get)

    const setPreset = Effect.fn("CliSetups.setPreset")(function*(cli: CliName, preset: CliPreset | null) {
      if (preset === null) {
        yield* settings.remove(presetKey(cli))
        return yield* get(cli)
      }
      if (CLI_PRESETS[preset].cli !== cli) {
        return yield* new SettingsError({ message: `${CLI_PRESETS[preset].label} isn't a setup for ${CLI_LABEL[cli]}.` })
      }
      yield* settings.set(presetKey(cli), preset)
      return yield* get(cli)
    })

    const setVar = Effect.fn("CliSetups.setVar")(function*(cli: CliName, rawName: string, value: string, secret: boolean) {
      const name = rawName.trim()
      const problem = envNameProblem(name)
      if (problem !== null) return yield* new SettingsError({ message: problem })
      const vars = yield* varsOf(cli)
      const existing = vars.find((v) => v.name === name)
      if (secret) {
        if (value.trim() === "") {
          // an existing secret kept as it is (only its flag or position asked for)
          if (existing?.secret !== true) return yield* new SettingsError({ message: "Paste the secret value." })
        } else {
          yield* secrets.writeStored(secretAccount(cli, name), Redacted.make(value.trim())).pipe(
            Effect.mapError((error) =>
              new SettingsError({
                message: error.code === "invalid"
                  ? "A secret value can only have letters, digits and - _ . : / + = @ ~ % , (no spaces or quotes)."
                  : error.message
              })
            )
          )
        }
      } else if (existing?.secret === true) {
        // a secret turned plain: its stored value goes
        yield* secrets.removeStored(secretAccount(cli, name)).pipe(Effect.mapError((error) => new SettingsError({ message: error.message })))
      }
      const entry: StoredVar = { name, value: secret ? null : value, secret }
      const next = existing === undefined ? [...vars, entry] : vars.map((v) => v.name === name ? entry : v)
      yield* settings.set(envKey(cli), next)
      return yield* get(cli)
    })

    const removeVar = Effect.fn("CliSetups.removeVar")(function*(cli: CliName, name: string) {
      const vars = yield* varsOf(cli)
      const existing = vars.find((v) => v.name === name)
      if (existing === undefined) return yield* get(cli)
      if (existing.secret) {
        yield* secrets.removeStored(secretAccount(cli, name)).pipe(Effect.mapError((error) => new SettingsError({ message: error.message })))
      }
      const next = vars.filter((v) => v.name !== name)
      yield* next.length === 0 ? settings.remove(envKey(cli)) : settings.set(envKey(cli), next)
      return yield* get(cli)
    })

    const missingKey = (cli: CliName, key: KeyName) =>
      new AgentError({
        code: "no-key",
        message: `${CLI_LABEL[cli]} is set to run on your ${KEY_LABEL[key]} key, but there's none saved. Add it in Settings › Accounts › Model keys, or switch ${CLI_LABEL[cli]} back to your sign-in.`
      })

    const requireKey = (cli: CliName, key: KeyName) =>
      Effect.flatMap(keyValue(key), Option.match({ onNone: () => Effect.fail(missingKey(cli, key)), onSome: Effect.succeed }))

    const resolve = Effect.fn("CliSetups.resolve")(function*(provider: CliProvider) {
      const cli = CLI_OF[provider]
      const preset = yield* presetOf(cli)
      const env: Record<string, string> = {}
      for (const v of yield* varsOf(cli)) {
        if (!v.secret) {
          env[v.name] = v.value ?? ""
          continue
        }
        const value = yield* secrets.readStored(secretAccount(cli, v.name))
        if (Option.isNone(value)) {
          return yield* new AgentError({ code: "no-key", message: `${CLI_LABEL[cli]}'s variable ${v.name} has no secret value in the Keychain. Set it again in Settings › Accounts.` })
        }
        env[v.name] = Redacted.value(value.value)
      }
      let apiKey: CliEnvironment["apiKey"] = null
      switch (preset) {
        case "claude-openrouter": {
          const key = yield* requireKey(cli, "openrouter")
          Object.assign(env, {
            ANTHROPIC_BASE_URL: OPENROUTER_ANTHROPIC_URL,
            ANTHROPIC_AUTH_TOKEN: Redacted.value(key),
            // explicitly empty: an Anthropic key would otherwise win over the router's token
            ANTHROPIC_API_KEY: "",
            CLAUDE_CONFIG_DIR: configDir(preset)
          })
          break
        }
        case "claude-anthropic":
          env.ANTHROPIC_API_KEY = Redacted.value(yield* requireKey(cli, "anthropic"))
          break
        case "codex-openai":
          apiKey = { key: yield* requireKey(cli, "openai"), home: configDir(preset) }
          break
        case "opencode-keys":
          for (const key of SHARED_KEYS) {
            const value = yield* keyValue(key)
            if (Option.isSome(value)) env[OPENCODE_KEY_VARS[key]] = Redacted.value(value.value)
          }
          break
        case null:
          break
      }
      const billing = cli === "claude" ? claudeBilling(env) : cli === "codex" ? apiKey === null ? "subscription" as const : "billed" as const : "billed" as const
      const routed = cli === "claude" && nonEmpty({ ...serverEnv, ...env }.ANTHROPIC_BASE_URL)
      return { environment: { env, apiKey }, billing, costBasis: routed ? "estimate" : null } satisfies CliRun
    })

    return CliSetups.of({ all, get, setPreset, setVar, removeVar, resolve })
  })

  static readonly layer = Layer.effect(CliSetups, CliSetups.make).pipe(
    Layer.provide([Settings.layer, Secrets.layer, ViralHome.layer, NodeServices.layer])
  )
}
