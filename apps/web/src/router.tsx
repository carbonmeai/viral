import { createHashHistory, createRouter } from "@tanstack/react-router"
import { routeTree } from "./routeTree.gen.ts"

// Hash history works the same from the dev server and from the packaged app's viral://app/ origin.
export const router = createRouter({ routeTree, history: createHashHistory(), defaultPreload: "intent" })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
