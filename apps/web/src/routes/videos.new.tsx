import { createFileRoute, redirect } from "@tanstack/react-router"
import { fromNewPage } from "../modules/home/home-search.ts"

// Everything starts in Home's box now; the old New page (?kind=one|several|idea) lands there, an idea on its card.
export const Route = createFileRoute("/videos/new")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/", search: fromNewPage(search), replace: true })
  }
})
