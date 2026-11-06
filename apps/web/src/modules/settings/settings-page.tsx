import { Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { ReactNode } from "react"
import { Page } from "../layout/page.tsx"
import { sectionLabel, type SettingsSectionId } from "./sections.ts"

// A Settings section: the same page column as every other page, titled with the section's name, holding groups
// of setting rows.
export function SettingsPage({ section, description, actions, children }: {
  readonly section: SettingsSectionId
  readonly description?: string
  readonly actions?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <Page title={sectionLabel(section)} {...(description === undefined ? {} : { description })} {...(actions === undefined ? {} : { actions })}>
      <div className="grid gap-6">{children}</div>
    </Page>
  )
}

// What a section shows while its data loads, or when the server can't be reached.
export function Pending({ children }: { readonly children: ReactNode }) {
  return <div className="rounded-panel bg-panel px-4 py-4 text-fg-2">{children}</div>
}

// Renders a query's value, or what's happening instead: still loading, or a failure in plain words.
export function Loaded<A, E>({ result, what, children }: {
  readonly result: AsyncResult.AsyncResult<A, E>
  // what is being loaded, for the messages: "your accounts"
  readonly what: string
  readonly children: (value: A) => ReactNode
}) {
  const value = AsyncResult.value(result)
  if (Option.isSome(value)) return children(value.value)
  if (AsyncResult.isFailure(result)) return <Pending>Couldn’t load {what}. Is the Viral server running?</Pending>
  return <Pending>Loading {what}…</Pending>
}
