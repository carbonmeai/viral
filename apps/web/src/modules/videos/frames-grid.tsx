import { clock } from "../../lib/format.ts"
import { FrameImage } from "./frame-image.tsx"
import type { FrameView } from "./video-values.ts"

// Every frame the contact sheets kept, one image each, labelled with its time in the video.
export function FramesGrid({ frames, srcOf }: { readonly frames: ReadonlyArray<FrameView>; readonly srcOf: (frame: FrameView) => string }) {
  if (frames.length === 0) {
    return <div className="rounded-panel bg-panel px-4 py-6 text-fg-2">No frames yet. They're made while the video is read.</div>
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 rounded-panel bg-panel p-3">
      {frames.map((frame) => (
        <figure key={`${frame.file}-${frame.t}`} className="m-0">
          <FrameImage frame={frame} src={srcOf(frame)} />
          <figcaption className="mt-1 text-xs text-fg-2">{clock(frame.t)}</figcaption>
        </figure>
      ))}
    </div>
  )
}
