import { useEffect, useState } from "react"
import { desktop } from "../../config/server-url.ts"

// How much room the macOS window buttons take at the start of the sidebar's top row: their width in the
// desktop app, nothing in full screen (macOS hides them) or in a browser.
export const windowControlsInset = (bridge: { readonly windowControlsInset: number } | undefined, fullScreen: boolean) =>
  bridge === undefined || fullScreen ? 0 : bridge.windowControlsInset

export function useWindowControlsInset() {
  const [fullScreen, setFullScreen] = useState(false)
  useEffect(() => desktop?.onFullScreenChange(setFullScreen), [])
  return windowControlsInset(desktop, fullScreen)
}
