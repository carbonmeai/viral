import type { ProjectId } from "@viral/contracts"

// The settings key holding the voiceover word a short's music drop lands on, when you picked one; without it
// the drop lands on the start of the last narrated line.
export const dropWordKey = (projectId: ProjectId) => `project.${projectId}.music.dropWord`

// The settings key holding a short's music arrangement (a MusicArrangement), when you made one; without it the
// bed is the automatic one. A different song removes it; a new drop word keeps it.
export const arrangementKey = (projectId: ProjectId) => `project.${projectId}.music.arrangement`
