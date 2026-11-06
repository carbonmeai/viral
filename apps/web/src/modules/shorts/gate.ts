import type { RunRequest } from "@viral/contracts"

// What a step can do about the gate waiting on it: approve, ask for changes with a note (the stage runs again in
// the same conversation), or send an edited version of its result.
export interface GateControls {
  // the gate waiting on this step, or null when there's nothing to answer here
  readonly request: RunRequest | null
  readonly busy: boolean
  readonly error: string | null
  approve(): void
  ask(note: string): void
  // checks first where the step can (the script); resolves to the problems when it was refused
  edit(artifact: unknown): Promise<ReadonlyArray<string>>
}
