---
name: thumbnails
description: How to make a short's thumbnail. By default an image model composes it from REAL frames you pick (a real on-screen graphic, 1–3 huge outlined words, the hero made dramatic with an escalation row, two or three real reactions side by side), then you check the options' faces against the real frames. Without an image key, the basic drawn thumbnail (bold or classic). Use when picking a thumbnail's frames, words and bands, or checking generated options.
---

# Thumbnails for shorts

The thumbnail is read in a fraction of a second at phone size, next to a dozen others. The creator's approved look is
a hyper-saturated MrBeast / Nick DiGiovanni picture with nothing empty in it, composed by an image model from real
frames of the video. Code-drawn layouts (blurred frame, Impact text, a red circle, a tilted inset) and faces cut out
and pasted on a backdrop were rejected as "rubbish" and "too plain".

## The four bands (top to bottom, nothing empty)

1. **A real graphic from the video** across the top: the score bar, the scale, a scoreboard, a level card, a price
   tag. Find it on the contact sheets; describe it exactly (`"SCOVILLE SCALE" bar graphic`). Leave it out (null) only
   when the video has none; then the words go on top.
2. **1–3 words of huge white text with a thick black outline**: the stake, not a sentence ("LEVEL 10", "TOP 1",
   "$10,000", "DAY 100", "7 TASTES"). They never spoil the ending and never claim what the short doesn't show.
3. **The hero object, huge and dramatised** (cracked open, glowing, on fire, molten), plus a supporting row under it
   that shows escalation ("8 peppers from a green bell pepper to a flaming red reaper"). The hero is the thing the
   short is about at its most striking: the finished candy, not the pot.
4. **Two or three real reactions of the person, big, side by side**, as contrasting as the video allows (calm and
   then in pain; before and after), plus a prop between them when there's an obvious one (a milk jug).

The background is one line: its colours and texture, saturated and on theme ("fiery red-orange with flames and
embers", "rainbow explosion with splashes").

## Picking the frames (only real frames, ever)

- **Reactions:** the 2–3 most extreme real expressions. Find the moments of most pain or surprise on the overview
  sheets, then step through them with `contact_sheet` at 0.25–0.5s; the peak often lasts under a second. Eyes squeezed,
  mouth open, sweating, hand on the forehead. A neutral or talking face is worse than a second reaction of the same
  peak. Two frames from the same second are one reaction.
- **The hero:** its sharpest, best-lit real frame, recognisable at a glance; no motion blur, not mid-cut.
- **The graphic:** a clean frame where it is fully on screen.
- **Never an AI face, and never an AI-made image as a reference:** the model copies it into the thumbnail (a rejected
  attempt had an earlier AI face copied into the right slot). Frames come from the video, nothing else.
- Check every frame with `preview_frames` (free) and Read them before you generate.

## Describing the person

Describe how they look so the model keeps them (face shape, hair, beard, glasses, clothes, a chain), never by name.
If they are a real public figure, put the name in `celebrity`: image models block real celebrities ("This generation
may violate our Terms of Service"), so nothing is sent and the creator is asked. When the creator's note says to try
anyway, leave it null.

## Checking the options

`generate_thumbnails` makes three options from the same frames and prompt. Read each next to the real reaction
frames and score its faces 0–10: 10 = the same face photographically, 5 = similar but redrawn or exaggerated, 0 =
someone else. Also check the words are spelled right, sit fully above the hero with nothing overlapping the letters,
and the graphic is clean. Recommend the option where **every** face matches; when none is good enough, recommend
null and say why in your notes, so the creator asks for another round.

## Adapting to the short

- **Experiment / challenge** (spicy, candy): the stage's graphic, the stake ("LEVEL 10"), the object dramatised, the
  person's calm and peak reactions.
- **Ranking:** #1's real before and after side by side as the bottom band, "TOP 1" (or "TOP 5") as the words.
- **Cut-down / podcast:** the speaker's two most extreme real expressions plus one big quote word.

## Shorts from several videos

Every frame names its video (`video`: its V number; leave it out for V1) and uses that video's own seconds; each
video's excluded ranges are its own. The reactions are one person's; prefer the video whose moment the hero shows.

## Basic thumbnail (no image key)

Without an image key Viral draws the thumbnail itself; the gate says so. You pick crops and words for a fixed layout:

- **Bold** (default, needs a strong reaction face): a saturated gradient, the hero and the face cut out with thick
  outlines, the face big and overlapping the hero, a red arrow to the hero or one emoji (🤢 disgust, 😱 shock, 🔥 heat).
  Pick the gradient to contrast with the hero and suit the mood (red for pain, yellow/orange for fun and disgust,
  blue/purple for mystery, green for gross).
- **Classic** (no face worth showing): a busy, colourful blurred frame from the hero's moment behind a framed hero
  with a circle on it, and a tilted face inset.
- **The face:** the most extreme real reaction at its peak, cropped to head and shoulders with nothing else attached
  (the cut-out keeps what's attached); it must stay sharp at half the thumbnail's height.
- **The hero crop:** its whole shape, tight enough to fill the slot; the circle goes on the hero itself.
- **The words:** a curiosity tease, 2–5 words on one or two lines ("IT BROKE HIM", "WORST CANDY EVER?"); yellow then
  white, red for the threat word. Bold sizes each line to fit (about 16 characters, e.g. "ANIMAL COMEBACKS"); classic
  keeps a line to 12 characters.
- `preview_thumbnail` draws a draft; Read it at phone size, fix, then propose.
