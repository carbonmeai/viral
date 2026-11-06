import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { Tool } from "@viral/contracts"
import { Progress } from "@viral/ui/primitives/progress"
import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useEffect } from "react"
import { Button } from "@viral/ui/primitives/button"
import { SettingRow, SettingsGroup } from "@viral/ui/primitives/setting-row"
import { Status } from "@viral/ui/primitives/status"
import { Detail } from "../../system/detail.tsx"
import { prefetchBackgroundRemoval, toolsAtom } from "../../tools/tools-api.ts"
import { downloadFraction, formatBytes, offersFallbackDownload, shortVersion, sourceLabel, TOOL_PURPOSE } from "../../tools/tools-values.ts"

// How often the page looks again while something downloads in the background.
const POLL_MS = 2000
import { Loaded, SettingsPage } from "../settings-page.tsx"

// Settings › Tools: each tool's version and where it comes from (Viral's own copy, or one on this Mac).
export function ToolsPage() {
  const tools = useAtomValue(toolsAtom)
  const refresh = useAtomRefresh(toolsAtom)
  const prefetch = useAtomSet(prefetchBackgroundRemoval, { mode: "promise" })
  const downloading = Option.match(AsyncResult.value(tools), { onNone: () => false, onSome: (list) => list.some((t) => t.status === "installing") })
  // follow a background download until it finishes
  useEffect(() => {
    if (!downloading) return
    const timer = setInterval(refresh, POLL_MS)
    return () => clearInterval(timer)
  }, [downloading, refresh])
  const startDownload = () => void prefetch({ payload: undefined }).then(refresh, refresh)
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
                {tool.status === "installing" && tool.progress !== null
                  ? <DownloadProgress tool={tool} />
                  : <span className="text-xs text-fg-2">{shortVersion(tool.version) ?? tool.error ?? "Not installed"}</span>}
                {offersFallbackDownload(tool) ? <Button onClick={startDownload}>Download fallback models</Button> : null}
                {tool.status === "ready"
                  ? <Status tone="ok">{sourceLabel(tool)}</Status>
                  : !tool.required && (tool.status === "missing" || tool.status === "failed")
                  ? <Button onClick={startDownload}>{tool.status === "failed" ? "Try again" : "Download now"}</Button>
                  : <Status tone="wait">{tool.status === "installing" ? "Downloading" : tool.status === "failed" ? "Couldn’t install" : "Missing"}</Status>}
              </SettingRow>
            ))}
          </SettingsGroup>
        )}
      </Loaded>
    </SettingsPage>
  )
}

// A background download: how far it's got, as a bar and in megabytes.
function DownloadProgress({ tool }: { readonly tool: Tool }) {
  const fraction = downloadFraction(tool)
  const done = tool.progress?.bytes ?? 0
  const total = tool.progress?.total ?? null
  return (
    <span className="flex w-[220px] items-center gap-2">
      <Progress value={fraction} label={`${tool.name} download`} className="flex-1" />
      <span className="shrink-0 text-xs text-fg-2 tabular-nums">
        {total === null ? formatBytes(done) : `${formatBytes(done)} of ${formatBytes(total)}`}
      </span>
    </span>
  )
}
