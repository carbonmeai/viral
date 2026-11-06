import type { ProjectId } from "@viral/contracts"

// The settings key holding the voiceover word a short's music drop lands on, when you picked one; without it
// the drop lands on the start of the last narrated line.
export const dropWordKey = (projectId: ProjectId) => `project.${projectId}.music.dropWord`
