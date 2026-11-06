// Small display helpers shared by the modules.

// 2296.0 → "38:16", 3852 → "1:04:12"
export const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = String(s % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`
}

// "2 min ago", "3 h ago", "yesterday", "4 d ago" from a time and now (both ms)
export const ago = (then: number, now: number) => {
  const minutes = Math.max(0, Math.round((now - then) / 60_000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? "yesterday" : `${days} d ago`
}

// "1 short", "3 shorts"
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
