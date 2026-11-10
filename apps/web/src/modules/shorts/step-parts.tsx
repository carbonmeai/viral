import type { EditorState } from "./use-editor-state.ts"

// A step whose work isn't made yet: what's happening, or that the run makes it when it gets here.
export function NotYet({ e, what }: { readonly e: EditorState; readonly what: string }) {
  return (
    <div className="grid flex-1 place-items-center px-6 text-center text-fg-2">
      {e.state === "running" ? (e.working?.message ?? `Making the ${what}…`) : `The ${what} is made when the run gets here.`}
    </div>
  )
}

// A panel whose step hasn't made its work yet.
export function NothingToInspect() {
  return <div className="px-3.5 py-2 text-sm text-fg-2">Nothing here yet. It fills in when the run gets to this step.</div>
}
