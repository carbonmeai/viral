import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import { Button } from "@viral/ui/primitives/button"
import { Panel } from "@viral/ui/primitives/panel"
import { Row, RowTitle } from "@viral/ui/primitives/row"
import { Status } from "@viral/ui/primitives/status"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { Detail } from "../system/detail.tsx"
import { toolsAtom } from "./tools-api.ts"
import { sourceLabel, TOOL_PURPOSE } from "./tools-values.ts"

// Settings › General: each tool's version and where it comes from (Viral's own copy, or one on this Mac).
export function ToolsPanel() {
  const tools = AsyncResult.value(useAtomValue(toolsAtom))
  const refresh = useAtomRefresh(toolsAtom)
  return (
    <Panel title="Tools" actions={<Button variant="ghost" onClick={refresh}>Check again</Button>}>
      {Option.match(tools, {
        onNone: () => <div className="px-1 py-3 text-fg-2">Looking for the tools…</div>,
        onSome: (list) =>
          list.map((tool) => (
            <Row key={tool.name} className="grid-cols-[minmax(0,1fr)_auto]">
              <RowTitle title={tool.name} sub={TOOL_PURPOSE[tool.name]} />
              <div className="flex min-w-0 flex-col items-end gap-1 text-xs text-fg-2">
                {tool.status === "ready"
                  ? <Status tone="ok">{sourceLabel(tool)}</Status>
                  : <Status tone="wait">{tool.status === "installing" ? "Installing" : tool.status === "failed" ? "Couldn't install" : "Missing"}</Status>}
                <span className="max-w-[320px] truncate" title={tool.version ?? undefined}>{tool.version ?? tool.error ?? "Not installed"}</span>
                <Detail>{tool.path === null ? null : <span className="max-w-[320px] truncate" title={tool.path}>{tool.path}</span>}</Detail>
              </div>
            </Row>
          ))
      })}
    </Panel>
  )
}
