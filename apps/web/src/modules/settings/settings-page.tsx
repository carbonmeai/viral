import { Skeleton, SkeletonRegion } from "@viral/ui/primitives/skeleton"
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

// What a section shows when there's nothing to show yet: an empty state, or a failure in plain words.
export function Pending({ children }: { readonly children: ReactNode }) {
  return <div className="rounded-panel bg-panel px-4 py-4 text-fg-2">{children}</div>
}

// One setting row in grey: its label, the line under it, and a control-sized block on the right.
export function SettingRowSkeleton({ control = 140 }: { readonly control?: number }) {
  return (
    <div className="flex min-h-[52px] items-center gap-4 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3 w-64 max-w-full" />
      </div>
      <Skeleton className="h-7 rounded-ctl" style={{ width: control }} />
    </div>
  )
}

// A section's groups of rows in grey, shaped like the page that's loading: e.g. [3] for one group of three,
// [2, 4] for two groups with headings.
export function SettingsSkeleton({ groups = [3], titled = false }: { readonly groups?: ReadonlyArray<number>; readonly titled?: boolean }) {
  return (
    <>
      {groups.map((rows, g) => (
        <section key={g} className="grid gap-2">
          {titled ? <Skeleton className="mx-1 h-4 w-40" /> : null}
          <div className="rounded-panel bg-panel px-4 [&>*+*]:shadow-[inset_0_1px_0_var(--color-line)]">
            {Array.from({ length: rows }, (_, i) => <SettingRowSkeleton key={i} />)}
          </div>
        </section>
      ))}
    </>
  )
}

// Renders a query's value; while it loads, the page's own layout in grey (by default, a group of rows); when the
// server can't be reached, a failure in plain words.
export function Loaded<A, E>({ result, what, skeleton, children }: {
  readonly result: AsyncResult.AsyncResult<A, E>
  // what is being loaded, for the messages: "your accounts"
  readonly what: string
  // the section's layout while it loads
  readonly skeleton?: ReactNode
  readonly children: (value: A) => ReactNode
}) {
  const value = AsyncResult.value(result)
  if (Option.isSome(value)) return children(value.value)
  if (AsyncResult.isFailure(result)) return <Pending>Couldn’t load {what}. Is the Viral server running?</Pending>
  return (
    <SkeletonRegion label={`Loading ${what}`} className="grid gap-6">
      {skeleton ?? <SettingsSkeleton />}
    </SkeletonRegion>
  )
}
