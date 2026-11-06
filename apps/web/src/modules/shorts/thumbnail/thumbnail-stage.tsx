// The thumbnail at the size it's judged at: in a phone-shaped frame, so you see what a viewer scrolling past sees.
export function ThumbnailStage({ url, layout }: { readonly url: string | null; readonly layout: "bold" | "classic" }) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center px-5 py-1.5">
      {url === null
        ? <span className="text-fg-2">The thumbnail hasn't been drawn.</span>
        : (
          // sized by its frame, not the image's own 1080×1920, so it never pushes past the stage
          <div className="relative aspect-[9/16] h-full max-h-[540px] max-w-full overflow-hidden rounded-[14px] bg-black shadow-[0_0_0_1px_var(--line-2)]">
            <img src={url} alt={`The ${layout} thumbnail`} className="absolute inset-0 size-full object-cover" />
          </div>
        )}
    </div>
  )
}
