import type { ReactNode } from "react"
import { TitleBar } from "./title-bar.tsx"

export interface PageProps {
  readonly title: string
  readonly description?: string
  // the page's main actions, on the right of its header
  readonly actions?: ReactNode
  readonly children: ReactNode
}

// A page outside a short: the title bar, then one centred 1080px column with the header (title, a muted
// line, actions) and the content. Every page uses it, so they all line up.
export function Page({ title, description, actions, children }: PageProps) {
  return (
    <>
      <TitleBar title={title} />
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto max-w-[1080px] px-6 pt-10 pb-24">
          <header className="mb-[22px] flex items-start gap-4">
            <div className="min-w-0">
              <h1 className="m-0 text-lg font-semibold">{title}</h1>
              {description === undefined ? null : <p className="m-0 mt-1 text-md text-fg-2">{description}</p>}
            </div>
            {actions === undefined ? null : <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
          </header>
          {children}
        </div>
      </div>
    </>
  )
}
