import { useAtom } from "@effect/atom-react"
import { Panel } from "@viral/ui/primitives/panel"
import { Row } from "@viral/ui/primitives/row"
import { Segmented } from "@viral/ui/primitives/segmented"
import { Page } from "../layout/page.tsx"
import { type Theme, themeAtom } from "../system/preferences.ts"

// Settings. M1 has the appearance; accounts, agents and usage arrive in M6.
export function SettingsPage() {
  const [theme, setTheme] = useAtom(themeAtom)
  return (
    <Page title="Settings" description="Accounts, the model behind each agent, and what things cost.">
      <div className="grid gap-2">
        <Panel title="Appearance">
          <Row className="grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">Theme</span>
              <span className="text-xs text-fg-2">System follows your Mac’s light or dark setting.</span>
            </div>
            <Segmented<Theme>
              label="Theme"
              value={theme}
              onChange={setTheme}
              options={[{ value: "system", label: "System" }, { value: "dark", label: "Dark" }, { value: "light", label: "Light" }]}
            />
          </Row>
        </Panel>
        <div className="rounded-panel bg-panel px-4 py-4 text-fg-2">Accounts, agents and usage arrive in M6 of the desktop plan.</div>
      </div>
    </Page>
  )
}
