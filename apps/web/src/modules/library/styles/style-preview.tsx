import type { PresetConfig } from "@viral/contracts"
import { cn } from "@viral/ui/cn"
import { previewLayout, sampleCaption } from "../library-values.ts"

const DISPLAY = "font-[Anton,Impact,sans-serif] uppercase [paint-order:stroke]"

// A style drawn as a 9:16 phone frame: a real frame from one of your shorts in the style's framing (a sharp
// band over a blurred fill, or cropped to fill), its headline, a caption with the highlighted word, and the
// extras it turns on (quote box, label, credit). Drawn in the page from the settings, so it changes as you edit.
export function StylePreview({ config, frame, width, className }: {
  readonly config: PresetConfig
  // a frame of footage to show; null draws a neutral gradient
  readonly frame: string | null
  readonly width: number
  readonly className?: string
}) {
  const height = (width * 16) / 9
  const layout = previewLayout(config)
  const caption = sampleCaption(config)
  const image = frame === null ? "linear-gradient(135deg,#3a3a3a,#161616)" : `url("${frame}")`
  const font = (fraction: number) => Math.max(8, fraction * height)

  return (
    <div className={cn("relative shrink-0 overflow-hidden rounded-[10px] bg-black", className)} style={{ width, height }}>
      {config.framing === "band" ? (
        <>
          <div className="absolute -inset-4 bg-cover bg-center blur-md brightness-[0.62]" style={{ backgroundImage: image }} />
          <div
            className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-cover bg-center"
            style={{ backgroundImage: image, height: `${layout.band * 100}%` }}
          />
        </>
      ) : (
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: image }} />
      )}

      {config.headline === null || layout.headlineTop === null || layout.headlineSize === null ? null : (
        <div className="absolute inset-x-0 text-center leading-[1.02]" style={{ top: `${layout.headlineTop * 100}%` }}>
          {["ONE CANDY", "EVERY TASTE"].map((line, i) => (
            <div
              key={line}
              className={cn(DISPLAY, "[-webkit-text-stroke:1.5px_#000]")}
              style={{ color: config.headline!.colors[i], fontSize: font(i === 0 ? layout.headlineSize! : layout.headlineSize! * 0.62) }}
            >
              {line}
            </div>
          ))}
        </div>
      )}

      {config.labels ? (
        <span className="absolute left-1/2 -translate-x-1/2 rounded-[3px] bg-black/55 px-1.5 text-[8px] font-semibold tracking-[0.2em] text-white" style={{ top: "34%" }}>
          STICKY
        </span>
      ) : null}

      {config.captions.quoteBox ? (
        <span
          className="absolute left-1/2 max-w-[80%] -translate-x-1/2 rounded-[4px] bg-white/92 px-1.5 py-0.5 text-center text-[8px] font-semibold text-black"
          style={{ top: `${(config.captions.y - 0.12) * 100}%` }}
        >
          “It’s like glue.”
        </span>
      ) : null}

      {config.captions.enabled ? (
        <div className="absolute inset-x-2 -translate-y-1/2 text-center" style={{ top: `${layout.captionY * 100}%` }}>
          <span className={cn(DISPLAY, "[-webkit-text-stroke:2px_#000]")} style={{ fontSize: font(config.captions.mode === "word" ? 0.05 : 0.04), textTransform: "none" }}>
            {caption.words.map((word, i) => (
              <span key={i} style={{ color: i === caption.highlight ? config.captions.highlight : "#ffffff" }}>
                {i === 0 ? "" : " "}
                {word}
              </span>
            ))}
          </span>
        </div>
      ) : null}

      {config.credit ? <span className="absolute bottom-1.5 left-2 text-[7px] font-medium text-white/85">Video: NileBlue</span> : null}
    </div>
  )
}
