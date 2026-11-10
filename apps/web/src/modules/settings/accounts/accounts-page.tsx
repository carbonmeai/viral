import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { Account, KeyCheck, KeyName } from "@viral/contracts"
import { MODEL_KEYS, VOICE_KEYS } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { SettingRow, SettingsGroup } from "@viral/ui/primitives/setting-row"
import { Status } from "@viral/ui/primitives/status"
import { cn } from "@viral/ui/cn"
import { useState } from "react"
import { modeAtom } from "../../system/preferences.ts"
import { accountsAtom, removeSecret, setSecret, testSecret } from "../settings-api.ts"
import { Loaded, SettingsPage, SettingsSkeleton } from "../settings-page.tsx"
import { KEY_ABOUT, keyRowState } from "./accounts-values.ts"

const CLI_ABOUT = {
  claude: { label: "Claude", sub: "Every agent runs on your Claude CLI, signed in as you." },
  codex: { label: "Codex", sub: "Runs agent steps on your ChatGPT plan through the Codex CLI." },
  opencode: { label: "OpenCode", sub: "Runs agent steps on the providers you’ve signed in to in OpenCode." }
} as const

type CliName = keyof typeof CLI_ABOUT
const isCli = (account: Account): account is Account & { readonly name: CliName } => account.name in CLI_ABOUT
const isKey = (account: Account): account is Account & { readonly name: KeyName } => account.name in KEY_ABOUT

// Settings › Accounts: the signed-in apps Viral runs, and the API keys it keeps (in your Mac's Keychain). A key you
// paste is checked with one free call before it's saved, and only its last four characters are ever shown again.
export function AccountsPage() {
  const accounts = useAtomValue(accountsAtom)
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
              <SettingsGroup title="Signed-in apps">
                {list.filter(isCli).map((account) => <CliRow key={account.name} account={account} name={account.name} />)}
              </SettingsGroup>
              <SettingsGroup
                title="Model keys"
                description="Only the AI Gateway runs agent steps today. The others can be added and tested now; choosing their models in Agents comes next."
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

function CliRow({ account, name }: { readonly account: Account; readonly name: CliName }) {
  const about = CLI_ABOUT[name]
  const facts = [name === "claude" ? null : account.version, account.detail].filter((x) => x !== null).join(" · ")
  const status = CLI_STATUS[account.status]
  return (
    <SettingRow label={about.label} sub={account.hint === null ? facts || about.sub : `${facts === "" ? "" : `${facts}. `}${account.hint}`}>
      <Status tone={status.tone}>{status.text}</Status>
    </SettingRow>
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
