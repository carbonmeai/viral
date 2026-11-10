import { Detail } from "../system/detail.tsx"
import type { EditorState } from "./use-editor-state.ts"

// The stage's top line: what's shown (left), then the short's style and, in Detailed mode, its approach.
export function StageBar({ e, left }: { readonly e: EditorState; readonly left: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2 px-3.5 py-2.5">
      <span className="text-xs text-fg-2">{left}</span>
      <StyleChips e={e} />
    </div>
  )
}

// The short's style and (Detailed) approach as small chips, pushed to the right of their row.
export function StyleChips({ e }: { readonly e: EditorState }) {
  return (
    <>
      <span className="ml-auto inline-flex h-[22px] items-center rounded-chip bg-ctl px-2 text-xs text-fg-1">{e.ws.preset.name}</span>
      <Detail><span className="inline-flex h-[22px] items-center rounded-chip bg-ctl px-2 text-xs text-fg-1">{e.ws.project.approach}</span></Detail>
    </>
  )
}

// A step whose work isn't made yet: what's happening, or that the run makes it when it gets here.
export function NotYet({ e, what }: { readonly e: EditorState; readonly what: string }) {
  return (
    <div className="grid flex-1 place-items-center px-6 text-center text-fg-2">
      {e.state === "running" ? (e.working?.message ?? `Making the ${what}…`) : `The ${what} is made when the run gets here.`}
    </div>
  )
}

// The inspector of a step whose work isn't made yet.
export function NothingToInspect() {
  return <div className="p-4 text-xs text-fg-2">Nothing to inspect here yet.</div>
}
