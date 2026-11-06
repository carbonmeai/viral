import { createFileRoute } from "@tanstack/react-router"
import { StylesPage } from "../modules/library/styles/styles-page.tsx"

// ?edit=<style id> opens that style's editor.
export const Route = createFileRoute("/library/styles")({
  validateSearch: (search: Record<string, unknown>): { readonly edit?: string } =>
    typeof search["edit"] === "string" ? { edit: search["edit"] } : {},
  component: StylesRoute
})

function StylesRoute() {
  const { edit } = Route.useSearch()
  return <StylesPage editing={edit} />
}
