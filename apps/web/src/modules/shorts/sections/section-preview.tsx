import type { PresetConfig } from "@viral/contracts"
import { Skeleton } from "@viral/ui/primitives/skeleton"
import { useEffect, useRef } from "react"

const cased = (text: string, mode: PresetConfig["captions"]["case"]) =>
  mode === "upper" ? text.toUpperCase() : mode === "lower" ? text.toLowerCase() : text

// The first few words a section says, as the caption shows them (the renderer shows three at a time).
export const captionOf = (text: string, maxWords: number) =>
  text.split(/\s+/).filter((w) => w !== "").slice(0, Math.max(1, maxWords)).join(" ").replace(/[.,;:]+$/, "")

// One section of a cut-down short as it will look (9:16): `crop` fills the frame with the footage (centred at
// `cropX`), `blur` plays the whole frame in a band over a blurred fill. The hook card sits over the first section
// in styles that show one, and the caption where the style puts captions. While `playing`, the video plays in
// place of the still.
export function SectionPreview({ still, video, playing, framing, cropX, caption, hookText, captions }: {
  readonly still: string | null
  // the long video, seeked to the section, while it plays
  readonly video: { readonly url: string; readonly start: number; readonly end: number; readonly onEnd: () => void } | null
  readonly playing: boolean
  readonly framing: "crop" | "blur"
  readonly cropX: number
  readonly caption: string
  readonly hookText: string | null
  readonly captions: PresetConfig["captions"]
}) {
  const ref = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (el === null || video === null) return
    if (!playing) {
      el.pause()
      return
    }
    el.currentTime = video.start
    const stop = () => {
      if (el.currentTime >= video.end) {
        el.pause()
        video.onEnd()
      }
    }
    el.addEventListener("timeupdate", stop)
    void el.play().catch(() => video.onEnd())
    return () => el.removeEventListener("timeupdate", stop)
  }, [playing, video])

  const picture = (className: string, style?: React.CSSProperties) =>
    playing && video !== null
      ? <video ref={ref} src={video.url} className={className} style={style} playsInline />
      : still === null
      ? <Skeleton className={`${className} rounded-none`} {...(style === undefined ? {} : { style })} />
      : <img src={still} alt="" className={className} style={style} />

  return (
    <div className="relative aspect-[9/16] h-full max-h-[540px] max-w-full overflow-hidden rounded-[10px] bg-black [container-type:inline-size]">
      {framing === "blur" ? (
        <>
          {still === null ? null : <div className="absolute -inset-8 bg-cover bg-center blur-[18px] brightness-[.62]" style={{ backgroundImage: `url("${still}")` }} />}
          {picture("absolute inset-x-0 top-1/2 aspect-video w-full -translate-y-1/2 object-cover")}
        </>
      ) : (
        picture("absolute inset-0 size-full object-cover", { objectPosition: `${cropX * 100}% 50%` })
      )}
      {hookText === null ? null : (
        <div className="absolute inset-x-[10%] top-[14%] rounded-[3cqw] bg-white px-[4cqw] py-[3cqw] text-center font-[Anton,Impact,sans-serif] text-[7cqw] leading-[1.15] text-black uppercase shadow-[0.8cqw_1cqw_0_rgba(0,0,0,.45)]">
          {hookText}
        </div>
      )}
      {captions.enabled && caption !== "" ? (
        <div
          className="absolute inset-x-[6%] -translate-y-1/2 text-center font-[Anton,Impact,sans-serif] text-[8.5cqw] leading-[1.1] text-white [paint-order:stroke] [-webkit-text-stroke:1.5px_#000]"
          style={{ top: `${captions.y * 100}%` }}
        >
          {cased(caption, captions.case)}
        </div>
      ) : null}
    </div>
  )
}
