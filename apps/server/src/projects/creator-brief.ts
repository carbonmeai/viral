// The creator's brief as the first line of an agent stage's brief, or nothing when there's none.
export const creatorBriefLine = (brief: string | null | undefined) => {
  const text = brief?.trim() ?? ""
  return text === "" ? "" : `The creator's brief for this short: ${text}`
}
