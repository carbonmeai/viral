import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { TranscriberChoice } from "@viral/contracts"
import { Segmented } from "@viral/ui/primitives/segmented"
import { SettingRow, SettingsGroup } from "@viral/ui/primitives/setting-row"
import { appSettingsAtom, setTranscriber } from "../settings-api.ts"
import { Loaded, SettingsPage } from "../settings-page.tsx"

// Settings › Transcription: who turns speech into word-timed text.
export function TranscriptionPage() {
  const settings = useAtomValue(appSettingsAtom)
  const save = useAtomSet(setTranscriber, { mode: "promise" })
  return (
    <SettingsPage section="transcription" description="Who turns the video’s speech, and the voiceover, into word-timed text.">
      <Loaded result={settings} what="your settings">
        {(value) => (
          <SettingsGroup>
            <SettingRow
              label="Provider"
              sub={value.transcriberFromEnvironment !== null
                ? `VIRAL_TRANSCRIBER=${value.transcriberFromEnvironment} is set, so it’s used instead of this choice.`
                : "Automatic uses Grok when an xAI key is saved, otherwise Whisper on this Mac."}
            >
              <Segmented<TranscriberChoice>
                label="Transcription provider"
                value={value.transcriber}
                onChange={(choice) => void save({ payload: { choice }, reactivityKeys: ["settings"] }).catch(() => undefined)}
                options={[{ value: "auto", label: "Automatic" }, { value: "grok", label: "Grok" }, { value: "whisper-local", label: "Whisper" }]}
              />
            </SettingRow>
          </SettingsGroup>
        )}
      </Loaded>
    </SettingsPage>
  )
}
