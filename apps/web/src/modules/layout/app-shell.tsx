import { useAtomRefresh } from "@effect/atom-react"
import { useLocation } from "@tanstack/react-router"
import { type ReactNode, useEffect } from "react"
import { overviewAtom } from "../home/overview.ts"
import { ToolsGate } from "../tools/tools-setup.tsx"
import { Sidebar } from "./sidebar.tsx"

const REFRESH_MS = 5_000

// The fixed frame: the sidebar on the left and the current page on the right. Pages change what's inside;
// nothing changes the frame. A short's editor fills the window instead (its back arrow returns to Home).
export function AppShell({ children }: { readonly children: ReactNode }) {
  const refresh = useAtomRefresh(overviewAtom)
  useEffect(() => {
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])
  const editor = useLocation({ select: (location) => location.pathname.startsWith("/shorts/") })
  if (editor) {
    return <main className="flex h-full min-h-0 min-w-0 flex-col bg-bg"><ToolsGate>{children}</ToolsGate></main>
  }
  return (
    <div className="grid h-full grid-cols-[220px_minmax(0,1fr)]">
      <Sidebar />
      <main className="flex min-h-0 min-w-0 flex-col bg-bg"><ToolsGate>{children}</ToolsGate></main>
    </div>
  )
}
