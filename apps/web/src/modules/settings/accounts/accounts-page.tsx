import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { Account, CliEnvVar, CliName, CliSetup, KeyCheck, KeyName } from "@viral/contracts"
import { envNameProblem, MODEL_KEYS, VOICE_KEYS } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Dialog } from "@viral/ui/primitives/dialog"
import { Input } from "@viral/ui/primitives/input"
import { Menu, MenuItem } from "@viral/ui/primitives/menu"
import { Select } from "@viral/ui/primitives/select"
import { SettingRow, SettingsGroup } from "@viral/ui/primitives/setting-row"
import { Status } from "@viral/ui/primitives/status"
import { Switch } from "@viral/ui/primitives/switch"
import { cn } from "@viral/ui/cn"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useState } from "react"
import { modeAtom } from "../../system/preferences.ts"
import { accountsAtom, cliSetupsAtom, removeCliEnvVar, removeSecret, setCliEnvVar, setCliPreset, setSecret, testSecret } from "../settings-api.ts"
import { Loaded, SettingsPage, SettingsSkeleton } from "../settings-page.tsx"
import { cliSetupLines, type EnvLine, envLines, KEY_ABOUT, keyRowState, PRESET_ABOUT, type RunsOn, runsOnOptions } from "./accounts-values.ts"

const CLI_ABOUT = {
  claude: { label: "Claude", sub: "Every agent runs on your Claude CLI, signed in as you." },
  codex: { label: "Codex", sub: "Runs agent steps on your ChatGPT plan through the Codex CLI." },
  opencode: { label: "OpenCode", sub: "Runs agent steps on the providers you’ve signed in to in OpenCode." }
} as const satisfies Record<CliName, { readonly label: string; readonly sub: string }>

const isCli = (account: Account): account is Account & { readonly name: CliName } => account.name in CLI_ABOUT
const isKey = (account: Account): account is Account & { readonly name: KeyName } => account.name in KEY_ABOUT

// Settings › Accounts: the signed-in apps Viral runs, and the API keys it keeps (in your Mac's Keychain). A key you
// paste is checked with one free call before it's saved, and only its last four characters are ever shown again.
export function AccountsPage() {
  const accounts = useAtomValue(accountsAtom)
  const setups = Option.getOrElse(AsyncResult.value(useAtomValue(cliSetupsAtom)), (): ReadonlyArray<CliSetup> => [])
  return (
    <SettingsPage section="accounts" description="The services Viral works with. Keys are kept in your Mac’s Keychain; only their last four characters are shown.">
      <Loaded result={accounts} what="your accounts" skeleton={<SettingsSkeleton groups={[3, 5, 2]} titled />}>
        {(list) => {
          const keyRows = (names: ReadonlyArray<KeyName>) =>
            names.flatMap((name) => list.filter(isKey).filter((a) => a.name === name)).map((account) => (
              <KeyRow key={account.name} account={account} name={account.name} />
            ))
          return (
            <>
              <SettingsGroup
                title="Signed-in apps"
                description="Each runs on your sign-in, or on a key you saved below instead (billed to that key). Add your own environment variables from ⋯."
              >
                {list.filter(isCli).map((account) => (
                  <CliRow
                    key={account.name}
                    account={account}
                    name={account.name}
                    setup={setups.find((s) => s.cli === account.name)}
                    keysSaved={new Set(list.filter((a) => isKey(a) && a.status === "ready").map((a) => a.name))}
                  />
                ))}
              </SettingsGroup>
              <SettingsGroup
                title="Model keys"
                description="Each key runs agent steps on its models; pick them per step in Agents. Steps that look at images stay on the Claude CLI for now."
              >
                {keyRows(MODEL_KEYS)}
              </SettingsGroup>
              <SettingsGroup title="Voice and transcription">{keyRows(VOICE_KEYS)}</SettingsGroup>
            </>
          )
        }}
      </Loaded>
    </SettingsPage>
  )
}

// A CLI Viral runs as you: whether it's installed, signed in and new enough, and if not, what to run. Viral
// never installs, signs in or updates a CLI for you.
const CLI_STATUS: Record<Account["status"], { readonly tone: "ok" | "wait" | "neutral"; readonly text: string }> = {
  ready: { tone: "ok", text: "Connected" },
  "signed-out": { tone: "wait", text: "Signed out" },
  outdated: { tone: "wait", text: "Update needed" },
  missing: { tone: "neutral", text: "Not installed" }
}

function CliRow({ account, name, setup, keysSaved }: {
  readonly account: Account
  readonly name: CliName
  readonly setup: CliSetup | undefined
  readonly keysSaved: ReadonlySet<string>
}) {
  const about = CLI_ABOUT[name]
  const detailed = useAtomValue(modeAtom) === "detailed"
  const savePreset = useAtomSet(setCliPreset, { mode: "promise" })
  const [editing, setEditing] = useState<CliEnvVar | "new" | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const facts = [name === "claude" ? null : account.version, account.detail].filter((x) => x !== null).join(" · ")
  const status = CLI_STATUS[account.status]
  const runsOn: RunsOn = setup?.preset ?? "signin"
  const variables = envLines(setup, detailed)
  const choose = (next: RunsOn) => {
    setNotice(null)
    savePreset({ payload: { cli: name, preset: next === "signin" ? null : next }, reactivityKeys: ["accounts"] })
      .catch((e: unknown) => setNotice(messageOf(e)))
  }
  const lines = [
    ...(account.hint === null ? [] : [{ text: account.hint, tone: "muted" as const }]),
    ...cliSetupLines(setup, detailed),
    ...(notice === null ? [] : [{ text: notice, tone: "warn" as const }])
  ]
  return (
    <div className="pb-1">
      <SettingRow label={about.label} sub={<Lines lines={[{ text: facts || about.sub, tone: "muted" }, ...lines]} />}>
        <Status tone={status.tone}>{status.text}</Status>
        {name === "opencode"
          ? (
            <label className="flex items-center gap-2 text-sm text-fg-2" title={PRESET_ABOUT["opencode-keys"]}>
              Share my keys
              <Switch label="Share my keys with OpenCode" checked={runsOn === "opencode-keys"} onChange={(on) => choose(on ? "opencode-keys" : "signin")} />
            </label>
          )
          : (
            <Select<RunsOn>
              label={`${about.label} runs on`}
              className="w-[190px]"
              value={runsOn}
              onChange={choose}
              options={runsOnOptions(name, setup, keysSaved)}
            />
          )}
        <Menu label={`More for ${about.label}`}>
          <MenuItem onClick={() => setEditing("new")}>Add environment variable…</MenuItem>
        </Menu>
      </SettingRow>
      {variables.length === 0 ? null : (
        <div className="mb-2 grid min-w-0 grid-cols-1 gap-0.5 rounded-ctl px-3 py-1 shadow-[inset_0_0_0_1px_var(--color-line)]">
          {variables.map((line) => (
            <EnvVarLine
              key={`${line.fromSetup ? "setup" : "own"}-${line.name}`}
              cli={name}
              line={line}
              onChange={() => {
                const own = setup?.env.find((v) => v.name === line.name)
                if (own !== undefined) setEditing(own)
              }}
            />
          ))}
        </div>
      )}
      {editing === null ? null : (
        <EnvVarDialog cli={name} label={about.label} editing={editing} preset={setup?.presetVars ?? []} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function EnvVarLine({ cli, line, onChange }: { readonly cli: CliName; readonly line: EnvLine; readonly onChange: () => void }) {
  const remove = useAtomSet(removeCliEnvVar, { mode: "promise" })
  return (
    <div className="flex min-h-7 items-center gap-3 text-xs">
      <span className="w-[260px] shrink-0 truncate font-mono font-medium" title={line.name}>{line.name}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-fg-2" title={line.secret ? undefined : line.value}>{line.value}</span>
      {line.secret ? <Status tone="neutral">Secret</Status> : null}
      {line.fromSetup
        ? <span className="w-7 text-center text-fg-3" title="Set by the setup above">·</span>
        : (
          <Menu label={`More for ${line.name}`}>
            <MenuItem onClick={onChange}>Change…</MenuItem>
            <MenuItem tone="danger" onClick={() => void remove({ payload: { cli, name: line.name }, reactivityKeys: ["accounts"] })}>Remove</MenuItem>
          </Menu>
        )}
    </div>
  )
}

// Adding or changing one variable. A secret's value is never shown again: changing it means pasting a new one (or
// leaving it empty to keep it).
function EnvVarDialog({ cli, label, editing, preset, onClose }: {
  readonly cli: CliName
  readonly label: string
  readonly editing: CliEnvVar | "new"
  readonly preset: CliSetup["presetVars"]
  readonly onClose: () => void
}) {
  const save = useAtomSet(setCliEnvVar, { mode: "promise" })
  const isNew = editing === "new"
  const [name, setName] = useState(isNew ? "" : editing.name)
  const [value, setValue] = useState(isNew || editing.secret ? "" : editing.value ?? "")
  const [secret, setSecretFlag] = useState(isNew ? false : editing.secret)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nameProblem = name.trim() === "" ? null : envNameProblem(name.trim())
  const keepsSecret = !isNew && editing.secret && secret && value === ""
  const shadowed = preset.some((v) => v.name === name.trim())
  const submit = () => {
    if (busy || name.trim() === "" || nameProblem !== null) return
    setBusy(true)
    setError(null)
    save({ payload: { cli, name: name.trim(), value, secret }, reactivityKeys: ["accounts"] })
      .then(onClose)
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(() => setBusy(false))
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => open ? undefined : onClose()}
      title={isNew ? `Add a variable for ${label}` : `Change ${editing.name}`}
      description="Passed to this app’s runs only, never to Viral itself. Secret values are kept in your Mac’s Keychain."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || name.trim() === "" || nameProblem !== null} onClick={submit}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <label className="grid gap-1 text-xs text-fg-2">
          Name
          <Input
            aria-label="Variable name"
            autoFocus={isNew}
            disabled={!isNew}
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
            placeholder="ANTHROPIC_BASE_URL"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </label>
        <label className="grid gap-1 text-xs text-fg-2">
          Value
          <Input
            aria-label="Variable value"
            autoFocus={!isNew}
            type={secret ? "password" : "text"}
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
            placeholder={!isNew && editing.secret ? "Leave empty to keep the saved value" : secret ? "Paste the secret" : "Leave empty to set it empty"}
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" ? submit() : undefined}
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="grid">
            <span>Secret</span>
            <span className="text-xs text-fg-2">Kept in the Keychain and shown as dots. For tokens and keys.</span>
          </span>
          <Switch label="Secret" checked={secret} onChange={setSecretFlag} />
        </label>
        <Lines
          lines={[
            ...(nameProblem === null ? [] : [{ text: nameProblem, tone: "warn" as const }]),
            ...(shadowed ? [{ text: `The current setup sets ${name.trim()} itself, which wins over this one.`, tone: "muted" as const }] : []),
            ...(keepsSecret ? [{ text: "The saved secret stays as it is.", tone: "muted" as const }] : []),
            ...(error === null ? [] : [{ text: error, tone: "warn" as const }])
          ]}
        />
      </div>
    </Dialog>
  )
}

const messageOf = (e: unknown) => typeof e === "object" && e !== null && "message" in e ? String(e.message) : "That didn’t work."

// What just happened on a row: a check's result, or a failure, shown until the next action.
type Notice = { readonly text: string; readonly tone: "muted" | "warn" | "ok" }
const noticeOf = (check: KeyCheck): Notice => ({ text: check.message, tone: check.code === "ok" ? "ok" : "warn" })

function Lines({ lines }: { readonly lines: ReadonlyArray<Notice> }) {
  return (
    <span className="grid gap-0.5">
      {lines.map((line, i) => (
        <span key={i} className={cn(line.tone === "warn" ? "text-wait" : line.tone === "ok" ? "text-ok" : "text-fg-2")}>{line.text}</span>
      ))}
    </span>
  )
}

function KeyRow({ account, name }: { readonly account: Account; readonly name: KeyName }) {
  const save = useAtomSet(setSecret(name), { mode: "promise" })
  const remove = useAtomSet(removeSecret(name), { mode: "promise" })
  const test = useAtomSet(testSecret(name), { mode: "promise" })
  const detailed = useAtomValue(modeAtom) === "detailed"
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState("")
  const [notice, setNotice] = useState<Notice | null>(null)
  // what's running: the label its button shows meanwhile
  const [busy, setBusy] = useState<"checking" | "testing" | "removing" | null>(null)

  const about = KEY_ABOUT[name]
  const state = keyRowState(account, about.sub, detailed, Date.now())
  const ready = account.status === "ready"

  const checkAndSave = () => {
    if (value.trim() === "" || busy !== null) return
    setBusy("checking")
    setNotice(null)
    save(value)
      .then((saved) => {
        setEditing(false)
        setValue("")
        setNotice(noticeOf(saved.check))
      })
      .catch((e: unknown) => setNotice({ text: messageOf(e), tone: "warn" }))
      .finally(() => setBusy(null))
  }
  const retest = () => {
    setBusy("testing")
    setNotice(null)
    test(null)
      .then((check) => setNotice(noticeOf(check)))
      .catch((e: unknown) => setNotice({ text: messageOf(e), tone: "warn" }))
      .finally(() => setBusy(null))
  }
  const removeKey = () => {
    setBusy("removing")
    setNotice(null)
    remove()
      .catch((e: unknown) => setNotice({ text: messageOf(e), tone: "warn" }))
      .finally(() => setBusy(null))
  }

  if (editing) {
    return (
      <SettingRow
        label={about.label}
        sub={<Lines lines={notice === null ? [{ text: `Paste your ${about.label} key. Viral checks it with a free call before saving it.`, tone: "muted" }] : [notice]} />}
      >
        <Input
          aria-label={`${about.label} API key`}
          type="password"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          className="w-[240px]"
          value={value}
          placeholder="API key"
          disabled={busy !== null}
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") checkAndSave()
            if (e.key === "Escape") setEditing(false)
          }}
        />
        <Button variant="ghost" disabled={busy !== null} onClick={() => {
          setEditing(false)
          setValue("")
          setNotice(null)
        }}>
          Cancel
        </Button>
        <Button variant="primary" disabled={busy !== null || value.trim() === ""} onClick={checkAndSave}>
          {busy === "checking" ? "Checking…" : "Check and save"}
        </Button>
      </SettingRow>
    )
  }

  const envNote = state.canChange ? undefined : `${account.envVar ?? "An environment variable"} is set, so a saved key would be ignored.`
  const lines: ReadonlyArray<Notice> = notice === null ? state.lines : [...state.lines.filter((l) => !l.text.startsWith("Checked ")), notice]
  return (
    <SettingRow label={about.label} sub={<Lines lines={lines} />}>
      <Status tone={state.chip.tone}>{state.chip.text}</Status>
      {state.canTest
        ? <Button disabled={busy !== null} onClick={retest}>{busy === "testing" ? "Testing…" : "Test"}</Button>
        : null}
      {ready
        ? (
          <Button disabled={busy !== null || !state.canChange} title={envNote} onClick={() => {
            setNotice(null)
            setEditing(true)
          }}>
            Change
          </Button>
        )
        : (
          <Button disabled={busy !== null} onClick={() => {
            setNotice(null)
            setEditing(true)
          }}>
            Add key
          </Button>
        )}
      {ready
        ? (
          <Button
            variant="ghost"
            className="text-danger hover:text-danger"
            disabled={busy !== null || !state.canRemove}
            title={envNote}
            onClick={removeKey}
          >
            {busy === "removing" ? "Removing…" : "Remove"}
          </Button>
        )
        : null}
    </SettingRow>
  )
}
