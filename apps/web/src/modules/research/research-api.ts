import { ViralClient } from "../../api/client.ts"

// Research mode's writes: start one from an idea, look up a link you add to the shortlist, check your changed list,
// and replace one of the set's videos.
export const startResearch = ViralClient.mutation("StartResearch")
export const lookupShortlistVideo = ViralClient.mutation("LookupShortlistVideo")
export const checkShortlistEdit = ViralClient.mutation("CheckShortlistEdit")
export const replaceResearchVideo = ViralClient.mutation("ReplaceResearchVideo")
