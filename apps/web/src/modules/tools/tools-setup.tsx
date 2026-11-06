import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import type { Tool } from "@viral/contracts"
import { Button } from "@viral/ui/primitives/button"
import { Panel } from "@viral/ui/primitives/panel"
import { Progress } from "@viral/ui/primitives/progress"
import { Row, RowTitle } from "@viral/ui/primitives/row"
import { Status } from "@viral/ui/primitives/status"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { type ReactNode, useState } from "react"
import { Page } from "../layout/page.tsx"
import { Detail } from "../system/detail.tsx"
import { installAtom, toolsAtom } from "./tools-api.ts"
import { formatBytes, installFinished, type InstallState, sourceLabel, TOOL_PURPOSE, type ToolInstall, toolsToInstall } from "./tools-values.ts"

// The first run: when a tool the pipeline needs is missing, the page area shows "Setting up tools" (inside
// the same shell) until it's installed. Everything else shows as usual.
export function ToolsGate({ children }: { readonly children: ReactNode }) {
  const tools = AsyncResult.value(useAtomValue(toolsAtom))
  const [continued, setContinued] = useState(false)
  // until the server answers, pages handle "can't reach the server" themselves
  if (continued || Option.isNone(tools) || toolsToInstall(tools.value).length === 0) return children
  return <ToolsSetup tools={tools.value} onContinue={() => setContinued(true)} />
}

function ToolsSetup({ tools, onContinue }: { readonly tools: ReadonlyArray<Tool>; readonly onContinue: () => void }) {
  const progress = AsyncResult.value(useAtomValue(installAtom))
  const retry = useAtomRefresh(installAtom)
  const refreshTools = useAtomRefresh(toolsAtom)
  const state: InstallState | null = Option.getOrNull(progress)
  const finished = state !== null && installFinished(state)
  const failed = state !== null && Object.values(state).some((t) => t?.phase === "failed")

  const done = () => {
    refreshTools()
    onContinue()
  }
  return (
    <Page
      title="Setting up tools"
      description="Viral needs a few tools to download, cut and transcribe videos. They're downloaded once into Viral's own folder; ones already on this Mac are used as they are."
      actions={finished
        ? (
          <>
            {failed ? <Button size="md" onClick={retry}>Try again</Button> : null}
            <Button variant={failed ? "default" : "primary"} size="md" onClick={done}>{failed ? "Continue anyway" : "Continue"}</Button>
          </>
        )
        : null}
    >
      <Panel title="Tools" count={tools.length}>
        {tools.map((tool) => <ToolRow key={tool.name} tool={tool} install={state?.[tool.name]} />)}
      </Panel>
    </Page>
  )
}

function ToolRow({ tool, install }: { readonly tool: Tool; readonly install: ToolInstall | undefined }) {
  return (
    <Row className="grid-cols-[minmax(0,1fr)_260px]">
      <RowTitle title={tool.name} sub={TOOL_PURPOSE[tool.name]} />
      <div className="flex min-w-0 flex-col items-end gap-1 text-xs text-fg-2">
        {install === undefined
          ? <Status tone="ok">Ready · {sourceLabel(tool)}</Status>
          : install.phase === "installed"
          ? <Status tone="ok">Installed{install.version === null ? "" : ` · ${install.version}`}</Status>
          : install.phase === "failed"
          ? (
            <>
              <Status tone="wait">Couldn't install</Status>
              <span className="w-full truncate text-right" title={install.message ?? undefined}>{install.message}</span>
            </>
          )
          : (
            <>
              <Progress label={`Downloading ${tool.name}`} value={install.total === null ? null : install.bytes / install.total} />
              <span>
                {install.phase === "waiting" ? "Waiting" : `${formatBytes(install.bytes)}${install.total === null ? "" : ` of ${formatBytes(install.total)}`}`}
              </span>
            </>
          )}
        <Detail>{tool.path === null ? null : <span className="w-full truncate text-right">{tool.path}</span>}</Detail>
      </div>
    </Row>
  )
}
