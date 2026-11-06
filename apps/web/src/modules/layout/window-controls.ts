import { useEffect, useState } from "react"
import { desktop } from "../../config/server-url.ts"
import { windowControlsInset } from "./window-controls-values.ts"

// The window buttons' room right now, following the window in and out of full screen.
export function useWindowControlsInset() {
  const [fullScreen, setFullScreen] = useState(false)
  useEffect(() => desktop?.onFullScreenChange(setFullScreen), [])
  return windowControlsInset(desktop, fullScreen)
}
