import { useAtom } from "@effect/atom-react"
import { Input } from "@viral/ui/primitives/input"
import { Segmented } from "@viral/ui/primitives/segmented"
import { SettingRow, SettingsGroup } from "@viral/ui/primitives/setting-row"
import { desktop } from "../../../config/server-url.ts"
import { type Mode, modeAtom, nameAtom, type Theme, themeAtom } from "../../system/preferences.ts"
import { SettingsPage } from "../settings-page.tsx"

// Settings › General: how the app looks, how much detail it shows, and your name.
export function GeneralPage() {
  const [theme, setTheme] = useAtom(themeAtom)
  const [mode, setMode] = useAtom(modeAtom)
  const [name, setName] = useAtom(nameAtom)
  return (
    <SettingsPage section="general" description="How Viral looks and how much it shows you.">
      <SettingsGroup title="Appearance">
        <SettingRow label="Theme" sub="System follows your Mac’s light or dark setting.">
          <Segmented<Theme>
            label="Theme"
            value={theme}
            onChange={setTheme}
            options={[{ value: "system", label: "System" }, { value: "dark", label: "Dark" }, { value: "light", label: "Light" }]}
          />
        </SettingRow>
        <SettingRow label="Detail" sub="Detailed shows costs, models, timings and sources next to everything. Simple hides them.">
          <Segmented<Mode>
            label="Detail"
            value={mode}
            onChange={setMode}
            options={[{ value: "simple", label: "Simple" }, { value: "detailed", label: "Detailed" }]}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="You">
        <SettingRow label="Your name" sub="Shown at the bottom of the sidebar.">
          <Input
            aria-label="Your name"
            className="w-[220px]"
            value={name}
            placeholder={desktop?.userName || "Your name"}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </SettingRow>
      </SettingsGroup>
    </SettingsPage>
  )
}
