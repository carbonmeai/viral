import { APPROACHES, type ApproachName, type ProjectFormat } from "@viral/contracts"

// The format card you picked on Home before starting a set, kept per set in this browser so the set page can
// highlight the matching suggestion. A hint only: Viral still suggests three shorts.
const key = (setId: string) => `viral.made-as.${setId}`

export const rememberMadeAs = (setId: string, format: ProjectFormat | null) => {
  if (format === null) return
  try {
    localStorage.setItem(key(setId), format)
  } catch {
    // nothing to keep it in; the hint is lost
  }
}

export const madeAsFor = (setId: string): ProjectFormat | null => {
  try {
    const value = localStorage.getItem(key(setId))
    return value === "narrated" || value === "cut-down" || value === "ranking" ? value : null
  } catch {
    return null
  }
}

// Whether a suggestion is the format you asked for.
export const matchesMadeAs = (hint: ProjectFormat | null, approach: ApproachName) => hint !== null && APPROACHES[approach].format === hint
