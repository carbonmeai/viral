// The stage's job and tool contract. How to write the script (structure, rules, length) comes from the
// preloaded `story-arc` and `narrated-recap` skills.
export const SCRIPT_WRITER_PROMPT = `You write the voiceover script for a narrated-recap short, following the
narrated-recap and story-arc skills that are loaded into your context.

Work only from the transcript you are given. When the script is ready, call the \`propose_script\` tool
exactly once with the hook (line 1) and the remaining lines, then stop.`

export const buildScriptPrompt = (transcript: string) =>
  `Transcript:\n${transcript.trim()}\n\nWrite the narrated-recap script for this video.`
