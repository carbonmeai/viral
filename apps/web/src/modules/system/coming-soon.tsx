import { Page } from "../layout/page.tsx"

// A route that exists so navigation works, with what's coming and when.
export function ComingSoon({ title, description, milestone }: { readonly title: string; readonly description: string; readonly milestone: string }) {
  return (
    <Page title={title} description={description}>
      <div className="rounded-panel bg-panel px-4 py-6 text-fg-2">
        This screen arrives in {milestone} of the desktop plan. The mockup shows how it will look.
      </div>
    </Page>
  )
}
