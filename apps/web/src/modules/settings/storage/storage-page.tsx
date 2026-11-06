import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { Storage } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { SettingRow, SettingsGroup } from "@viral/ui/primitives/setting-row"
import { FolderOpen } from "lucide-react"
import { desktop } from "../../../config/server-url.ts"
import { formatBytes } from "../../tools/tools-values.ts"
import { storageAtom } from "../settings-api.ts"
import { Loaded, SettingsPage } from "../settings-page.tsx"

const AREAS: Record<Storage["areas"][number]["name"], { readonly label: string; readonly sub: string }> = {
  sources: { label: "Videos", sub: "Downloaded long videos, transcripts and contact sheets" },
  projects: { label: "Shorts", sub: "Scripts, voiceovers, shot plans and renders in progress" },
  renders: { label: "Finished shorts", sub: "The mp4, captions and post text of each published short" },
  music: { label: "Music", sub: "Tracks in your music library" },
  sounds: { label: "Sound effects", sub: "Samples in your sound library" },
  references: { label: "References", sub: "Viral videos kept to learn from" },
  "voice-previews": { label: "Voice previews", sub: "Sample lines spoken in different voices" },
  database: { label: "Database", sub: "Runs, costs and settings" }
}

// Opens a library path in Finder; only the desktop app can.
const FinderButton = ({ path, label }: { readonly path: string; readonly label?: string }) =>
  desktop === undefined ? null : (
    <Button variant="ghost" onClick={() => void desktop?.showInFinder(path)}>
      <FolderOpen />
      {label ?? "Show in Finder"}
    </Button>
  )

// Settings › Storage: where your library lives and how much space each part takes.
export function StoragePage() {
  const storage = useAtomValue(storageAtom)
  const refresh = useAtomRefresh(storageAtom)
  return (
    <SettingsPage section="storage" description="Everything Viral makes lives in one folder on this Mac." actions={<Button onClick={refresh}>Measure again</Button>}>
      <Loaded result={storage} what="your storage">
        {(value) => {
          const total = value.areas.reduce((n, a) => n + a.bytes, 0)
          return (
            <>
              <SettingsGroup>
                <SettingRow label="Library folder" sub={value.root}>
                  <FinderButton path={value.root} />
                </SettingRow>
              </SettingsGroup>
              <SettingsGroup title={`Space used · ${formatBytes(total)}`}>
                {[...value.areas].sort((a, b) => b.bytes - a.bytes).map((area) => (
                  <SettingRow key={area.name} label={AREAS[area.name].label} sub={AREAS[area.name].sub}>
                    <span className="tabular-nums text-fg-2">{formatBytes(area.bytes)}</span>
                    <FinderButton path={area.path} label="Show" />
                  </SettingRow>
                ))}
              </SettingsGroup>
            </>
          )
        }}
      </Loaded>
    </SettingsPage>
  )
}
