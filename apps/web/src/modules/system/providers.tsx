import { useAtomValue } from "@effect/atom-react"
import { TooltipProvider } from "@viral/ui/primitives/tooltip"
import { type PropsWithChildren, useEffect } from "react"
import { AppRegistryProvider } from "../../api/registry.ts"
import { themeAtom } from "./preferences.ts"

// Applies the chosen theme to <html>; "system" leaves it to the OS.
function ThemeSync() {
  const theme = useAtomValue(themeAtom)
  useEffect(() => {
    const root = document.documentElement
    if (theme === "system") root.removeAttribute("data-theme")
    else root.setAttribute("data-theme", theme)
  }, [theme])
  return null
}

// Everything the app needs around its routes: the atom registry, tooltips and the theme.
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <AppRegistryProvider>
      <TooltipProvider delay={400}>
        <ThemeSync />
        {children}
      </TooltipProvider>
    </AppRegistryProvider>
  )
}
