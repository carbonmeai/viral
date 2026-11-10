import { createFileRoute, redirect } from "@tanstack/react-router"
import { WAITING_SEARCH } from "../modules/home/home-search.ts"

// Waiting for you is a filter on Home's recents now; old links land there.
export const Route = createFileRoute("/waiting")({
  beforeLoad: () => {
    throw redirect({ to: "/", search: WAITING_SEARCH, replace: true })
  }
})
