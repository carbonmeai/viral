---
name: narrated-shots
description: How to plan the shots of a narrated short (any narrated approach). B-roll anchored to voiceover words, framing, pacing, excluded ranges, labels and markers, and where real-voice inserts and outro clips go. Use when planning the shot list of a narrated short.
---

# Shots for narrated shorts

## B-roll

- **Anchor each shot to the voiceover word it illustrates** (a word index plus that word's text), not to
  seconds, so re-voicing or speeding up never breaks the sync. The first shot starts on word 0.
- **The shot matches its words.** "Machine" shows the machine, "powder" shows the powder, "he tasted it"
  shows him tasting it. When a line is about the creator, show the creator, not someone else.
- **Pace:** follow the style's target average shot length (about 1.3s for a fast recap, about 2.2s for an
  interleaved short). Change shots on the words that matter, not mechanically.
- **Open on the payoff.** The first shot (word 0) shows the finished result or the most striking frame (the
  tray of skull candies), not the start of the process. The hook earns the first second.
- **Never repeat footage.** Each shot gets its own moment; two shots from the same few seconds read as a stall.
- **Full framing crops the 16:9 frame to 9:16**, keeping the middle third. When the subject sits to one side,
  set `cropX` (0 = left edge, 1 = right edge) so it stays in frame.
- **Use the whole frame (`fit`) for on-screen graphics or text**, so nothing important is cropped. Speed
  (`speed`) suits slow processes and graphics that build up.
- **Pick frames from the contact sheets**, then refine with finer sheets around the moment. A shot's source
  time is where the action starts.
- **Look at what you picked before you submit.** A tile in a 5-second sheet can hide a cut: the second you
  chose may be a wide shot, a different person, or the moment before the action. Check each shot's actual first
  frame against its words and move the ones that don't match.
- **Never use sponsor, ad, QR or end-screen footage.** Those ranges are excluded and the renderer refuses
  any shot that touches them.

## Markers

- **A circle or arrow on the hero object** at one or two key moments.
- **Small text labels** ("STICKY", "VERSION 2") when the style allows them: one or two words that name what
  the viewer is looking at, timed to the word that introduces it.

## Real voices

- **Inserts** play during the narration: each sits after a voiceover word (the end of the line that sets it
  up). The narration pauses, the clip plays with its own audio, then the narration resumes. A new shot should
  start right where the narration resumes, so the frame before the insert doesn't repeat.
- **Outro clips** play after the last narrated line: the final reaction, or the joke button.
- **Every real clip is exact source seconds** from the transcript's word timings: start on the first word,
  end just after the last, and keep it clear of excluded ranges.
