import { useAtomRefresh } from "@effect/atom-react"
import { type ReactNode, useEffect } from "react"
import { overviewAtom } from "../home/overview.ts"
import { ToolsGate } from "../tools/tools-setup.tsx"
import { Sidebar } from "./sidebar.tsx"

const REFRESH_MS = 5_000

// The fixed frame: the sidebar on the left and the current page on the right. Pages change what's inside;
// nothing changes the frame.
export function AppShell({ children }: { readonly children: ReactNode }) {
  const refresh = useAtomRefresh(overviewAtom)
  useEffect(() => {
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])
  return (
    <div className="grid h-full grid-cols-[220px_minmax(0,1fr)]">
      <Sidebar />
      <main className="flex min-h-0 min-w-0 flex-col bg-bg"><ToolsGate>{children}</ToolsGate></main>
    </div>
  )
}
