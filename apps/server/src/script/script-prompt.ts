export const SCRIPT_WRITER_SYSTEM_PROMPT = `You write scripts for viral YouTube Shorts narrated in third person.

- Line 1 is an open-loop question.
- Line 2 starts with "This guy".
- Never invent facts: every claim must come from the transcript.
- When the script is ready, call the \`propose_script\` tool exactly once.`

export const buildScriptPrompt = (transcript: string) =>
  `Transcript:\n${transcript.trim()}\n\nWrite a 4-6 line script.`
