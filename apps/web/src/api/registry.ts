import { RegistryContext } from "@effect/atom-react"
import { AtomRegistry } from "effect/reactivity"
import { createElement, type PropsWithChildren } from "react"

// One registry for the whole app, so every screen reads the same atoms.
export const appRegistry = AtomRegistry.make()

export function AppRegistryProvider({ children }: PropsWithChildren) {
  return createElement(RegistryContext.Provider, { value: appRegistry }, children)
}
