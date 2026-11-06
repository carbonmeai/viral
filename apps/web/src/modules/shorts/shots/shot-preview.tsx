import type { PresetConfig } from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import { headlineSize } from "./shots-values.ts"

const cased = (word: string, mode: PresetConfig["captions"]["case"]) =>
  mode === "upper" ? word.toUpperCase() : mode === "lower" ? word.toLowerCase() : word

// One frame of the short as it will look (9:16): in the band layout the footage sits in a sharp 16:9 band over a
// blurred fill; in full framing it fills the frame (cropped at `cropX`), unless the shot shows the whole frame.
// The caption word sits where the style puts captions.
export function ShotPreview({ src, framing, fit, cropX, word, highlighted, captions, headline }: {
  readonly src: string | null
  readonly framing: PresetConfig["framing"]
  readonly fit: boolean
  readonly cropX: number
  readonly word: string
  readonly highlighted: boolean
  readonly captions: PresetConfig["captions"]
  // the short's pinned headline, in styles that show one
  readonly headline?: { readonly lines: readonly [string, string]; readonly style: NonNullable<PresetConfig["headline"]> } | null
}) {
  const band = framing === "band" || fit
  const clean = word.replace(/[.,!?;:"“”]+/g, "")
  return (
    <div className="relative aspect-[9/16] h-full max-h-[540px] max-w-full overflow-hidden rounded-[10px] bg-black [container-type:inline-size]">
      {src === null ? null : band ? (
        <>
          <div className="absolute -inset-8 bg-cover bg-center blur-[18px] brightness-[.62]" style={{ backgroundImage: `url("${src}")` }} />
          <img src={src} alt="" className="absolute inset-x-0 top-1/2 aspect-video w-full -translate-y-1/2 object-cover" />
        </>
      ) : (
        <img src={src} alt="" className="absolute inset-0 size-full object-cover" style={{ objectPosition: `${cropX * 100}% 50%` }} />
      )}
      {headline === null || headline === undefined ? null : (
        <div
          className="absolute inset-x-0 text-center font-[Anton,Impact,sans-serif] whitespace-nowrap uppercase [paint-order:stroke] [-webkit-text-stroke:1.5px_#000]"
          style={{ top: `${headline.style.y * 100}%` }}
        >
          {headline.lines.map((line, i) => (
            <div key={i} className="leading-[1.08]" style={{ color: headline.style.colors[i], fontSize: `${headlineSize(line, i, headline.style.size)}cqw` }}>{line}</div>
          ))}
        </div>
      )}
      {captions.enabled && clean !== "" ? (
        <div
          className={cn(
            "absolute inset-x-0 -translate-y-1/2 text-center font-[Anton,Impact,sans-serif] text-[32px] [paint-order:stroke] [-webkit-text-stroke:1.5px_#000]",
            highlighted ? "" : "text-white"
          )}
          style={{ top: `${captions.y * 100}%`, ...(highlighted ? { color: captions.highlight } : {}) }}
        >
          {cased(clean, captions.case)}
        </div>
      ) : null}
    </div>
  )
}
