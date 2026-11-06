// Formatting for Settings › Usage.
export const formatUsd = (usd: number) =>
  usd === 0 ? "$0" : usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`

export const formatCount = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n)

// Bar heights (0–1) for the daily chart, scaled to the busiest day; an all-zero period draws no bars.
export const barHeights = (values: ReadonlyArray<number>) => {
  const top = Math.max(0, ...values)
  return values.map((v) => (top === 0 ? 0 : v / top))
}

// A short date label, "Nov 6", for a YYYY-MM-DD day.
export const dayLabel = (day: string) => {
  const [, month, date] = day.split("-")
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${names[Number(month) - 1] ?? month} ${Number(date)}`
}
