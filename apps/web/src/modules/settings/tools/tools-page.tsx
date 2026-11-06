import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import { Button } from "@viral/ui/primitives/button"
import { SettingRow, SettingsGroup } from "@viral/ui/primitives/setting-row"
import { Status } from "@viral/ui/primitives/status"
import { Detail } from "../../system/detail.tsx"
import { toolsAtom } from "../../tools/tools-api.ts"
import { shortVersion, sourceLabel, TOOL_PURPOSE } from "../../tools/tools-values.ts"
import { Loaded, SettingsPage } from "../settings-page.tsx"

// Settings › Tools: each tool's version and where it comes from (Viral's own copy, or one on this Mac).
export function ToolsPage() {
  const tools = useAtomValue(toolsAtom)
  const refresh = useAtomRefresh(toolsAtom)
  return (
    <SettingsPage
      section="tools"
      description="The programs Viral uses to download, cut and transcribe. Missing ones are downloaded into Viral’s own folder."
      actions={<Button onClick={refresh}>Check again</Button>}
    >
      <Loaded result={tools} what="the tools">
        {(list) => (
          <SettingsGroup>
            {list.map((tool) => (
              <SettingRow
                key={tool.name}
                label={tool.name}
                sub={<>{TOOL_PURPOSE[tool.name]}<Detail>{tool.path === null ? null : <> · {tool.path}</>}</Detail></>}
              >
                <span className="text-xs text-fg-2">{shortVersion(tool.version) ?? tool.error ?? "Not installed"}</span>
                {tool.status === "ready"
                  ? <Status tone="ok">{sourceLabel(tool)}</Status>
                  : <Status tone="wait">{tool.status === "installing" ? "Installing" : tool.status === "failed" ? "Couldn’t install" : "Missing"}</Status>}
              </SettingRow>
            ))}
          </SettingsGroup>
        )}
      </Loaded>
    </SettingsPage>
  )
}
