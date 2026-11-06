import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { Account, KeyName } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Input } from "@viral/ui/primitives/input"
import { SettingRow, SettingsGroup } from "@viral/ui/primitives/setting-row"
import { Status } from "@viral/ui/primitives/status"
import { useState } from "react"
import { accountsAtom, removeSecret, setSecret } from "../settings-api.ts"
import { Loaded, SettingsPage, SettingsSkeleton } from "../settings-page.tsx"

const ABOUT: Record<Account["name"], { readonly label: string; readonly sub: string }> = {
  claude: { label: "Claude", sub: "Every agent runs on your Claude CLI, signed in as you." },
  elevenlabs: { label: "ElevenLabs", sub: "Voiceovers and voice samples." },
  xai: { label: "xAI", sub: "Grok transcription. Without it, Viral transcribes on this Mac with Whisper." },
  gateway: {
    label: "AI Gateway",
    sub: "Runs agent steps on other models: Haiku, GPT-6 Luna, Gemini… (Vercel AI Gateway). Sends the step’s material to that model’s provider."
  }
}

const sourceText = (account: Account) =>
  account.source === "environment" ? "From the environment" : account.source === "keychain" ? "In the Keychain" : account.source === "cli" ? "Found" : null

// Settings › Accounts: what Viral can use, and the API keys it keeps in your Mac's Keychain. A key you type
// goes straight to the Keychain; Viral never shows it again.
export function AccountsPage() {
  const accounts = useAtomValue(accountsAtom)
  return (
    <SettingsPage section="accounts" description="The services Viral works with. Keys are kept in your Mac’s Keychain and never shown again.">
      <Loaded result={accounts} what="your accounts" skeleton={<SettingsSkeleton groups={[4]} />}>
        {(list) => (
          <SettingsGroup>
            {list.map((account) => account.name === "claude"
              ? (
                <SettingRow key={account.name} label={ABOUT.claude.label} sub={account.detail ?? ABOUT.claude.sub}>
                  {account.status === "ready" ? <Status tone="ok">Connected</Status> : <Status tone="wait">Not found</Status>}
                </SettingRow>
              )
              : <KeyRow key={account.name} account={account} name={account.name} />)}
          </SettingsGroup>
        )}
      </Loaded>
    </SettingsPage>
  )
}

function KeyRow({ account, name }: { readonly account: Account; readonly name: KeyName }) {
  const save = useAtomSet(setSecret, { mode: "promise" })
  const remove = useAtomSet(removeSecret, { mode: "promise" })
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    action()
      .then(() => {
        setEditing(false)
        setValue("")
      })
      .catch((e: unknown) => setError(typeof e === "object" && e !== null && "message" in e ? String(e.message) : "That didn’t work."))
      .finally(() => setBusy(false))
  }
  const about = ABOUT[name]
  const ready = account.status === "ready"

  if (editing) {
    return (
      <SettingRow label={about.label} sub={error ?? `Paste your ${about.label} API key. It goes to the Keychain.`}>
        <Input
          aria-label={`${about.label} API key`}
          type="password"
          autoFocus
          className="w-[260px]"
          value={value}
          placeholder="API key"
          onChange={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && value.trim() !== "" && run(() => save({ payload: { name, value }, reactivityKeys: ["accounts"] }))}
        />
        <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        <Button
          variant="primary"
          disabled={busy || value.trim() === ""}
          onClick={() => run(() => save({ payload: { name, value }, reactivityKeys: ["accounts"] }))}
        >
          Save
        </Button>
      </SettingRow>
    )
  }
  return (
    <SettingRow label={about.label} sub={error ?? about.sub}>
      {ready ? <Status tone="ok">{sourceText(account) ?? "Key saved"}</Status> : <Status>Not set</Status>}
      {account.source === "environment"
        ? null
        : <Button onClick={() => setEditing(true)}>{ready ? "Replace" : "Add key"}</Button>}
      {account.source === "keychain"
        ? (
          <Button variant="ghost" className="text-danger hover:text-danger" disabled={busy} onClick={() => run(() => remove({ payload: { name }, reactivityKeys: ["accounts"] }))}>
            Remove
          </Button>
        )
        : null}
    </SettingRow>
  )
}
