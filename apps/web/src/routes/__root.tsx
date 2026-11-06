import { createRootRoute, Outlet } from "@tanstack/react-router"
import { AppShell } from "../modules/layout/app-shell.tsx"
import { AppProviders } from "../modules/system/providers.tsx"

export const Route = createRootRoute({
  component: () => (
    <AppProviders>
      <AppShell>
        <Outlet />
      </AppShell>
    </AppProviders>
  )
})
