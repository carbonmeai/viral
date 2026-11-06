import { useAtomValue } from "@effect/atom-react"
import type { ReactNode } from "react"
import { modeAtom } from "./preferences.ts"

// Shows its children in Detailed mode only, so the Simple view leaves the numbers out.
export function Detail({ children }: { readonly children: ReactNode }) {
  return useAtomValue(modeAtom) === "detailed" ? children : null
}

export const useDetailed = () => useAtomValue(modeAtom) === "detailed"
