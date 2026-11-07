// Who a short credits: each channel whose footage it uses and isn't yours, once, in the short's video order (V1
// first). A video with no channel can't be credited by name.
export const creditedChannels = (sources: ReadonlyArray<{ readonly rights: string; readonly channel: string | null }>) => [
  ...new Set(sources.flatMap((s) => s.rights !== "owned" && s.channel !== null ? [s.channel] : []))
]

// The credit line drawn on a short: "Video: NileBlue", or "Video: NileBlue · Mark Rober" across videos; null when
// there's no one to credit.
export const creditLine = (sources: ReadonlyArray<{ readonly rights: string; readonly channel: string | null }>) => {
  const channels = creditedChannels(sources)
  return channels.length === 0 ? null : `Video: ${channels.join(" · ")}`
}
