// The stage's job and tool contract. How to write the script (structure, rules, length) comes from the
// `story-arc` skill and the project's approach skill, which are appended to this prompt.
export const SCRIPT_WRITER_PROMPT = `You write the voiceover script for a narrated short, following the approach
skill and the story-arc skill included below.

Work only from the transcript you are given. When the script is ready, call the \`propose_script\` tool
exactly once with the hook (line 1) and the remaining lines, then stop.`

export const buildScriptPrompt = (transcript: string) =>
  `Transcript:\n${transcript.trim()}\n\nWrite the script for this video, following the approach skill.`
