# AGENTS.md

Viral helps content creators turn long videos into viral shorts. One headless Effect server owns the
pipeline (agent stages, media jobs, approvals, state); web, desktop (Electron) and mobile (Expo) are
thin clients over a typed Effect RPC WebSocket. The Claude CLI (via the Claude Agent SDK) is always
the default agent provider.

## Layout

Domain-driven and colocated: a domain folder owns its services, RPC handlers, prompts, scripts and
tests. There is no `features/` wrapper and no in-app `shared/` folder — domains import each other
directly.

```
apps/server/src/
  main.ts              wires domain layers + the RPC server; listens on 127.0.0.1 (VIRAL_PORT, default 3410) and
                       stops when the app that started it (VIRAL_PARENT_PID) is gone
  media/               GET /media/<path>: read-only files from the Viral home for the app (never viral.db,
                       symlinks checked, byte ranges for seeking) + GET /healthz
  home/                ~/.viral paths ($VIRAL_HOME overrides; tests use a temp dir)
  persistence/         SQLite client, foreign keys on, migrations (never edit a shipped one; add a new one). Migrations
                       run with foreign keys off, so one can rebuild a table the SQLite way; it checks the rows and
                       keys itself before it commits (0002-multi-video.ts upgrades libraries in place; 0005-ranking.ts
                       rebuilds projects the same way so its format CHECK allows 'ranking')
  sources/             long videos: row + ~/.viral/sources/<id>/, shared by every short that uses them;
                       source-stages.ts defines the video-level stages (source, transcribe, contact-sheet).
                       Links download at 1080p, else 720p, never higher, through Viral's own yt-dlp CLI like scans and
                       pieces (one retry for a 403 or a dropped connection); the size is kept in source-video. A video a
                       short or video set uses can't be deleted (SourceInUse, "used by N shorts"). A video's short name
                       (sources.short_name, 0007; null = made from the title in the app) is set with RenameVideo or
                       CreateSource's optional shortName (CLI: source rename, source add --name)
                       LookupVideoLink (video-links.ts): a link pasted on Home read with yt-dlp (no download; any
                       site yt-dlp reads), a YouTube one's thumbnail kept in ~/.viral/link-previews/ (served under
                       /media), answers cached while the server runs
                       Scans (R3): a link with `scan` (every video research adds) downloads 480p only, through Viral's
                       own yt-dlp CLI (fetch-source.py --scan; source-video `scan: true`), and everything reads it.
                       SourcePieces (source-pieces.ts, piece-ranges.ts, fetch-pieces.py) fetches the seconds a render
                       plays in 1080p into sources/<id>/pieces/ (pieces.json): ±1 s padding, stretches <2 s apart
                       merged, only what no piece covers, ONE `--download-sections` request per video, each piece's
                       start checked by matching its sound to the scan; a 403 or a dropped connection retried once
                       (youtube_download.py, shared with fetch-source.py; it runs Viral's own yt-dlp, never the uv
                       script environment's copy, which lacks the JS challenge solver). It never fails a render: what couldn't be fetched plays from the scan and
                       says why (`problem`). Your own files and plain links are never scans
  artifacts/           versioned stage outputs, one folder per version: <owner>/<kind>/v<N>/ (owners: a source, a
                       video set (~/.viral/sets/<id>/), a project, a reference)
  transcribe/          word-timed transcripts: Grok STT (xAI key) or local mlx-whisper on Apple Silicon
                       (transcripts.ts reads a source's transcript for planning stages; quote-match.ts snaps
                       an agent's quoted line to the transcript's exact word timings; sentences.ts is the skill's
                       speech.py: a word ending . ? ! … or a pause over 1.5 s ends a sentence, a "sentence" over 25 s
                       means no punctuation and is ignored. Nobody in a short is cut off mid-sentence: rankings' shots,
                       real lines and cut-down sections all snap with it)
  contact-sheet/       timestamped frame grids for picking b-roll by eye
  ads/                 the ads stage (Haiku): sponsor reads, ads, intros and end screens to keep out of shorts
  story/               the story stage: story beats with snapped quotes + 3 proposals (the three approaches that fit
                       best, each a different one), each of which `Projects.fromProposal` turns into a short, as it
                       is or as another single-video approach ("Make this short" › Story recap; CLI `--as`)
  video-sets/          video sets: 2–10 videos (source_set_members, V1 first) with a required brief, named from the
                       brief unless you name it; VideoSets (create, list, rename, delete only while no short came
                       from it) and GetVideoSetOverview (each video's read state and latest run, the set run, the
                       set story, the shorts from it)
  set-story/           the set-story stage, a set run's last stage: an agent (cross-video-story skill) proposes 3
                       shorts across the videos. It sees V1… labels and "[V2 724.3–726.1] text" lines: whole
                       transcripts under ~160k characters, else a line every 30 s plus `search_transcript` and
                       `read_transcript` (transcript-tools.ts). It answers with V numbers (1-based); checkSetStory
                       snaps each quote in its own video, keeps each video's ads out, needs every proposal to use ≥2
                       videos that each have a beat, and stores set positions (0-based `source`/`sources`). For a
                       set found from an idea it also says what a video is `missing` ("no after"), for Replace this
                       video. A set found from an idea that reads as a ranking (looksLikeRanking) opens with a
                       `narrated-ranking` proposal (the default ranking, M3) and may offer the list `ranking` too, each
                       using every video; other sets and single videos never get one (SINGLE_VIDEO_APPROACHES). "Make
                       this short" can make any proposal as "Ranking (narrated)" or "Ranking (list)"
                       (CreateProjectFromSetProposal `approach`; isRankingApproach: every video in the set)
  research/            research mode (R1): a video set from an idea (source_set_research: idea, 3/5/7/10 videos, length
                       60|180|any) that starts with no videos; its run is research → (each video read) → set-story.
                       The research stage (Haiku by default, `finding-source-videos` skill) has `search_youtube`
                       (yt-dlp --flat-playlist, 8 results) and `video_details` (description, chapters, start of the
                       English captions; never a download), 20 of each, one request at a time 1.5 s apart, and stops
                       asking once YouTube refuses (youtube.ts, research-tools.ts). The server looks every pick up and
                       checks it (shortlist-rules.ts: exists, not live, ≤20 min, once, exact count, ≤3 backups; a ranking
                       idea's picks also clear the skill's vetting, rankingProblems: no compilation, 1–6 min, someone
                       talking in the captions (picks are looked up with captions), and >1M views when enough found
                       videos clear that). A ranking idea finds the "Top N" it names, else 5 (videosForIdea); its length
                       estimate is a narrated ranking's (narratedRankingSeconds: 5 entries ≈ 2:12). It saves
                       thumbnails to sets/<id>/research/thumbs/, and records the `shortlist` set artifact behind the gate
                       "Download these videos?" (ShortlistGate; an Edit is checked again). Approving (researches.ts
                       adopt) adds each video (rights unconfirmed, channel kept, a note; a library video with the same
                       YouTube id is reused) as the set's videos; StageDefinition.beforePrerequisites makes the run read
                       them only after that. ReplaceResearchVideo: a backup takes the spot, or the shortlist records
                       `replacing` and the research searches again for that spot (keeping the others). Tests use
                       testing/fake-yt-dlp.ts (answers from the skill run's rescues search log; VIRAL_YT_DLP points
                       YouTube at it, VIRAL_YT_THUMBNAILS=off, VIRAL_YT_SPACING_MS=0; it also downloads: a blue 480p
                       stand-in scan, green pieces with a sound on the video's own clock, FAKE_YT_SECTIONS_403 refuses
                       pieces; VIRAL_YT_RETRY_PAUSE_S=0). A 403 download is retried once (youtube_download.py), then
                       fails as "blocked"; Viral never works around a block
                       `Projects.fromSetProposal` makes a short from a proposal's videos (set order) and the set's brief
  assemble/            the assemble stage: shot plan + preset (+ music with a known drop) → the renderer's
                       narrated plan, or a cut-down short's sections + preset → the cut-down renderer's plan;
                       deterministic, so a short re-renders in another style without agent work. A narrated short
                       from several videos lists V2… in the plan's `sources` and their ads in `exclude_by_source`;
                       the credit names each channel that isn't yours (projects/credits.ts, "Video: A · B").
                       Cut-down still stops on a section from another video (M5). A ranking's moments + preset →
                       assemble-ranking.ts → ranking.json (each entry's shots from its own video, the style's canvas
                       and loudness, `via` only when the style's rankingVia is on; no music or captions)
  music-bed/           a short's own music bed: the library holds raw songs only, never changed. Assemble fits the
                       short's song to it (render/fit-music.py: the groove looped in whole bars so the song's drop
                       lands on the drop word) and records a `music-bed` artifact (the wav + which parts of the song
                       play where); the narrated plan's `music_bed` points the renderer at it, so it doesn't fit again.
                       GetMusicBed reads it; RefitMusic changes the song (or removes it) and/or the drop word
                       (setting project.<id>.music.dropWord) and re-runs the short from assemble. A short can have
                       its own arrangement (project.<id>.music.arrangement; none = automatic): ordered blocks of the
                       song's bars (bar 0 the earliest whole bar before the drop), each looped N times, played after
                       the block before or pinned to start on the drop word or any voiceover word; music_bed.py's
                       `arrange` lays them out (lead-in ends on the first pin, gaps filled by looping in whole bars,
                       equal-power crossfades where unrelated parts meet, the last block loops to the end). The
                       automatic bed stays the original recipe, byte for byte, and describes itself as blocks.
                       music-arrangement.ts checks one in plain words (MusicArrangementInvalid); ArrangeMusic sets or
                       resets it and re-runs from assemble; PreviewMusicArrangement fits a throwaway bed in
                       projects/<id>/music-preview/ to listen to first. A new song resets the arrangement, a new drop
                       word keeps it (a "drop" block follows the word); one that no longer fits falls back to
                       automatic with a note. Cut-down shorts have no bed
  metadata/            the metadata stage (Haiku): title, alternates, description, hashtags; publishes the mp4,
                       srt and <slug>.md into ~/.viral/renders/. Several videos: each one labelled with what it
                       brings (the set story's line, else its own story), and the credit lists every channel. A
                       ranking: "Top 5 … (Before & After)" style, the description must end "Wait for #1.", and the
                       notes say "Footage:" with a sources list (each rank's channel and link, credits.ts)
                       publishing.ts (Publishing): the text you post with (a title you chose among the agent's, or
                       typed: 1–100 chars, YouTube's limit; your description and hashtags) is kept per short under
                       project.<id>.publish.post (new agent metadata clears it); GetPublishStatus says what "Publish
                       again" would update; PublishAgain (`project publish <id>`) rewrites <slug>.mp4/.srt/.md from
                       the latest render with your text and the credit as it is now, recorded as a new metadata
                       version with no stage run. When the credit drawn on the video changed (rights, channel or
                       style), it first re-runs assemble and render only (RunManager.start's forceThrough; later
                       stages reuse approved work, the run stops at one with none) and publishes when that run ends
  thumbnail/           the thumbnail stage, last in both pipelines (gated). With an image key it's AI (the short-thumbnail
                       skill, M4): a vision agent (thumbnails skill) picks REAL frames, two or three reactions, the hero
                       and an on-screen graphic, and writes the four bands (ProposedThumbnailDesign: graphic, 1-3 words,
                       hero + how to dramatise it, escalation row, reactions, how the person looks, prop, background,
                       `celebrity`); `preview_frames` takes the frames for free, `generate_thumbnails` makes one round
                       per attempt: thumbnail-images.ts takes the frames (from 1080p pieces of a scan), writes the prompt
                       from the skill's template (thumbnail-design.ts: images numbered, reactions first, "copy faces
                       photographically") and asks gpt-image-2.5-sunburst for 3 9:16 options at once, each scaled to
                       1080x1920. Service: ElevenLabs' Image & Video API first (POST /v1/flows/image + poll; needs a
                       Pro plan), else the AI Gateway (openai/gpt-image-2.5-sunburst via the AI SDK's generateImage;
                       used when ElevenLabs refuses for the plan, remembered while the server runs; GatewayImages is a
                       Context.Reference that only main.ts turns on, so tests never reach a real Gateway). Then the
                       agent scores each option's faces against the real reaction frames and recommends one
                       (propose_thumbnail: ThumbnailPick). Thumbnail.generated keeps the round (inputs, options,
                       checks, credits or costUsd, service), `image` is the option in use, `config` null. The gate
                       shows all three: Edit {choose: n} uses and publishes one, a rejection with a note makes another
                       round. A design naming a real public figure isn't sent (heldBack); refused options say why. The
                       round's spend goes to usage_records (step "thumbnail", billed: ElevenLabs credits estimated at
                       1,245 an image, or the Gateway's reported dollars). Without an image key, the basic thumbnail
                       (Decision 8, the gate says so): the agent picks the layout, the hero moment and crop, the
                       strongest reaction face, the colours and the words, with `contact_sheet` and `preview_thumbnail`;
                       crops are frame fractions turned into pixels.
                       render-thumbnail.py draws two layouts: `bold` (the default: a gradient, the hero and the face
                       cut out with outlines, curiosity words, an arrow or emoji) and `classic` (the skill's
                       thumbnail.py, unchanged). Cut-outs, per layer: macOS's own subject cut-out first
                       (cutout-apple.py, Vision, macOS 14+, no download; VIRAL_CUTOUT_APPLE=on|off overrides), then
                       rembg (cutout.py) if its models are on disk (~/Library/Caches/Viral/models, VIRAL_MODELS_DIR
                       overrides); otherwise the layer reports "fallback: needs rembg models" and the stage fetches
                       them with progress and draws again (thumbnail-draw.ts). Anything else falls back to a framed
                       inset; VIRAL_CUTOUT=off forces that. Once approved (the stage's `approved` hook) the jpg is published as
                       ~/.viral/renders/<slug>.jpg. A short from several videos: the agent sees every video's sheets and
                       answers with a 1-based `video` per layer or frame (ProposedThumbnail → ThumbnailProposal `source`); the
                       config keeps V1 as `source`, the others in `sources` and a layer `source` index (all absent for one
                       video, so single-video configs are byte-identical), and each layer is cut from its own video.
                       A ranking, list or narrated (ranking-thumbnail.ts, RankingMoments): bold, the hero inside #1's
                       after, the face layer inside #1's before (drawn as a tilted inset), "TOP N" over the subject;
                       AI: the hero inside #1's after and one reaction inside #1's before (checked), "TOP 1". A list
                       ranking's #1 has shots by role; a narrated ranking's after is #1's reveal take (its last real
                       line, as the shots placed it) and its before #1's earliest b-roll from its video ahead of the
                       reveal (else #1's first real line)
  script-runner/       runs the domains' uv Python scripts (JSON-line stdout protocol, stderr drained)
  secrets/             API keys: model keys (anthropic, openai, google, openrouter, gateway) and voice keys (elevenlabs,
                       xai). An env var (.env) wins (SECRETS lists them; google also reads GEMINI_API_KEY), else the saved
                       key in SecretStore (the macOS Keychain, service "viral", written via `security -i` on stdin; the
                       seam for a future Windows/Linux store). Saved keys never go into process.env, never to a client
                       (Accounts shows the last 4 characters) and never in a log. KeyChecks: one free call per key
                       (list models / key info, 10 s, no tokens), each in the domain that owns the key
                       (agent-session/model-key-checks.ts, voice/eleven-labs-key-check.ts, transcribe/xai-key-check.ts);
                       *_API_URL variables move a service for tests (testing/fake-key-services.ts). KeyAccounts: SetSecret
                       checks first (refused → not saved; unreachable → saved with a warning; refused while the env var
                       is set), TestSecret re-checks; the last result is kept in settings (keys.<name>.check).
                       Secrets.readStored/writeStored/removeStored: other secrets by account name, no env var in front
                       (a CLI's secret variables, cli.<cli>.env.<NAME>)
  cli-setup/           how each signed-in CLI runs (Settings › Accounts › Signed-in apps): on your sign-in, or on a
                       preset that reuses a saved model key (claude-openrouter: ANTHROPIC_BASE_URL + AUTH_TOKEN + empty
                       ANTHROPIC_API_KEY in its own CLAUDE_CONFIG_DIR ~/.viral/cli/claude-openrouter; claude-anthropic:
                       ANTHROPIC_API_KEY; codex-openai: Codex in CODEX_HOME ~/.viral/cli/codex-openai, signed in over
                       stdin with `account/login/start` apiKey, forced_login_method="api" and
                       cli_auth_credentials_store="ephemeral" so the key is never in argv, env or on disk;
                       opencode-keys: your Anthropic/OpenAI/Google/OpenRouter keys handed to OpenCode, off by default),
                       plus your own variables (settings cli.<cli>.preset / cli.<cli>.env; a secret's value in the
                       Keychain, shown as its last 4). envNameProblem (contracts/cli-setup.ts) refuses PATH, HOME,
                       NODE_OPTIONS, ELECTRON_RUN_AS_NODE, CODEX_HOME, DYLD_*, LD_*, VIRAL_*, OPENCODE_*…. CliSetups.resolve
                       builds one run's CliEnvironment (provider-core), handed only to that run's process; it also
                       decides billing: the Claude CLI is billed when its effective ANTHROPIC_API_KEY/AUTH_TOKEN is set
                       (a router's cost is an "estimate"), Codex on a key is billed and priced from PRICES
                       (GetCliSetups, SetCliPreset, SetCliEnvVar, RemoveCliEnvVar)
                       provider-core's redactSecrets hides keys in service and SDK error text
  tools/               ffmpeg, ffprobe, uv, yt-dlp: Viral's tools folder first (~/Library/Application Support/
                       Viral/tools; VIRAL_TOOLS_DIR overrides), then the PATH. Not bundled in the app: missing ones
                       are downloaded on first run from pinned URLs, checksum-verified (ffmpeg: hash recorded on the
                       first download), and the folder is put first on the server's PATH. yt-dlp is installed
                       through uv (`uv tool install`, uv's tool/bin/Python folders inside Viral's) because the
                       standalone macOS build takes 25–40 s to start; it upgrades via uv every few days.
                       ListTools / InstallTools. The background-removal models (rembg's isnet-general-use and
                       u2net_human_seg, ~355 MB, pinned by SHA-256, in ~/Library/Caches/Viral/models) are not
                       first-run tools. Where Apple's cut-out works (macOS 14+) they're only a fallback: never
                       prefetched, fetched when a thumbnail needs them or from Settings › Tools ("Download fallback
                       models"). Elsewhere the server fetches them in the background once the required tools are
                       ready (VIRAL_PREFETCH_MODELS=off skips), with progress in Settings › Tools
                       (PrefetchBackgroundRemoval)
  projects/            shorts: row + ~/.viral/projects/<id>/, numbered across the library (07-…; older shorts keep
                       their per-video numbers). A short draws from 1–10 videos (project_sources, V1 first;
                       sourcesOf(project)); several need a brief. A clip's optional `source` is its video's index
                       (absent = V1, so single-video plans are written as before). source-context.ts is what the
                       checks see per video (words, length, excluded ranges); ProjectSources loads a short's videos.
                       videos-brief.ts lays several videos out for an agent (V labels, "[V2 12.0–13.5] text" lines,
                       whole transcripts under ~160k characters, else outlines + the transcript tools); agents
                       answer with 1-based `video` numbers (ProposedScript, ProposedShots), stored as 0-based
                       `source`. Every step uses every video (script, shots, sections, assemble, render, metadata,
                       thumbnail). GetShortWorkspace's `videos` lists each one (position = colour index), and its
                       `folder` is the short's own folder (the editor's Show in Finder). RenameProject (CLI `project
                       rename`) sets the title only; the folder and files keep their names.
                       AddSourceToProject / RemoveSourceFromProject (CLI `project add-video | remove-video`): adding
                       re-runs nothing; a short's run first reads its videos after V1 that aren't read (prerequisites,
                       through ads). Removal is refused (ProjectSourceInUse, video-uses.ts names the steps) while the
                       latest script, shots, sections or thumbnail uses the video or a video after it (clips name
                       videos by place), while a run is running, and for the only video. credits.ts: the channels whose
                       footage plays, in order of first appearance (appearanceOrder over the shot plan or sections;
                       "I made it" videos get none), the same in the drawn credit, the post text and <slug>.md. A short's optional
                       brief (what it should achieve; CreateProject/CreateProjectFromProposal, SetProjectBrief) goes
                       first in the script, shots, sections, thumbnail and metadata prompts (creator-brief.ts)
  presets/             style profiles; one default, seeded on first start. Built-ins (added by name when missing, never
                       overwritten, so a change reaches new libraries only): Viral recap (the default) and Headline
                       full-bleed narrated by Marcus, Fast hype with Adam, Story recap (Viral recap with band 1280,
                       captions 0.78, softJoins and voiceLevel −10 LUFS / 1.7), Ranking narrated (Viral recap with
                       captions low at 0.855 in the blur under the picture, softJoins, voiceLevel; a narrated ranking
                       made without a style gets it). Two opt-ins, absent = as before:
                       `softJoins` (assemble writes soft_joins + insert_pad 0.25) and `voiceLevel` (the voice stage
                       loudnorms the take, assemble writes voice_gain). `commentQuestion` ("End with a comment question",
                       on in the built-ins of new libraries; a library's existing styles stay off until switched on in the
                       Style editor): the script ends with a Cta beat / the cut-down plan carries a `question`, and the
                       render ends on the end card (render/end_card.py). Edits (UpdatePreset) and renames
                       (RenamePreset) go through preset-rules.ts first; a bad one is PresetInvalid with plain problems
  music-library/       tracks (uploaded, imported from a link, or bundled) with origin and rights, in ~/.viral/music/;
                       each is a full song or an already edited clip (kind; SetMusicTrackKind). AddMusicFolder adds
                       every audio file in a folder and lists the ones it skipped;
                       analyse-track.py (librosa) measures tempo (beats fitted to a line), the drop (where the bass
                       below 150 Hz jumps, snapped to a beat; null when unclear) and LUFS, in the background on
                       add and via AnalyseMusicTrack. A beat set by hand (beat_source manual) is never overwritten
  sound-library/       sound-effect samples by category, with variants, in ~/.viral/sounds/<category>/. The generator
                       (sound-generator.ts, GenerateSoundEffect): ElevenLabs Sound Effects v3 takes from a prompt (length,
                       loop, takes, prompt influence), each kept with its prompt (origin Generated, a name from the
                       prompt + variant) and billed to usage_records; DeleteSoundEffect (never a bundled one). Placing
                       sounds on a short waits for the sound-design plan
  references/          viral videos kept to learn from; their analyses are reference-owned artifacts
  runs/                runs a source, a video set or a short through its stages: reuse of approved work, gates
                       (approve, reject with a note, edit), cancel, resume after restart, events + live progress. A
                       run's prerequisites (StageRegistry.prerequisites) run first: a set run reads each video that
                       needs it with that video's own source run through ads (two at a time, joining one already
                       going; cancelled with the set run), then runs set-story. StartProjectRun{from, note} redoes
                       an approved step with your note (its agent continues its last session, store.latestSession);
                       RunManager.events streams every run's updates with their owner (the chat follows them)
  chat/                one conversation per short (chat_items, migration 0008): ShortChat (chat-service.ts) follows
                       every run through RunManager.events (the run loop itself is unchanged) and writes, once per stage
                       run or request, each agent's version (describe-step.ts: its own words from tell_creator on a revision, else
                       the server's line; the change card from the domain's describe*Change against the version before;
                       the checks the stage's rules held it to), notes from voice / assemble (the music) / render,
                       gates, approvals and failures; an older short's thread is rebuilt once from its finished runs
                       ("Earlier", no change cards). SendChat routes by the open step (decision 9): at its gate →
                       Reject{note}; an approved agent step and an idle run → a redo with the note; busy elsewhere →
                       NotDone with "Stop and redo" (stopRun); voice / music / render / style → chat-intent.ts, a Haiku
                       intent agent (stage "chat", Claude CLI) choosing one ChatIntentAction (SetVoice, NewTake, Refit,
                       AutoArrangement, SetStyle, SendBack, CantDo) that the server checks and runs. DoChatAction runs a
                       chip's action as it is. change-lines.ts holds the card helpers; each domain owns its
                       *-changes.ts (script, shots, sections, moments/ranking, thumbnail, metadata, music-bed)
  script/              the script stage: prompt (built on the chosen proposal's angle), per-approach rules, and
                       the script gate. SCRIPT_LIMITS per approach: words, real lines, each real line's seconds
                       (0.8–8), whole sentences (every narrated approach: a quote widens to the sentences it's in; one
                       too long to play whole is a problem), and story-recap's `ending` (150–220 words, 5–8 real lines
                       plus the payoff as one 10–25 s take; real lines at the end less than 3 s apart merge into it).
                       scriptLimitsFor(approach, videos): a narrated ranking's limits grow with its entries (one per
                       video; rankingLimits) and carry `ranking`: checkCountdown wants a narrated hook, then entries
                       opening on "Number N" from N down to 1 (rankingEntries in contracts/script.ts; a hook line like
                       "Number one had already given up." stays in the hook), 1–2 real lines per entry from its own
                       video (#1's reveal take after the narration not counted), a video in one entry only, each entry
                       about 15–32 s (narration at 3.2 words/s + its real lines), #1's reveal as the 10–25 s ending.
                       A Narration beat can be `skipped`: voiced in the take, jumped over in the short because the real
                       line just before it says it (placeReals gives that insert a resumeWord; the creator toggles it
                       at the gate without a new take). The closing question is its own beat type, `Cta` ({question},
                       always last, written only when the style's commentQuestion is on, else refused): outside the word
                       and real-line budgets and every other check (checkScript runs them on the beats without it). The
                       narrator says closingLine(question) (+ "Tell us in the comments, and subscribe for more.") last in
                       the take; shots see the take only up to it (shot-rules storyTake); assemble writes narration_end
                       just before it and, with the switch on, the `cta` end card. Metadata/thumbnail briefs leave it out.
                       Several videos: the set proposal's angle and beats (video-sets/short-story.ts;
                       else each video's own story beats), every video's transcript, real lines checked per video
  voice/               ElevenLabs (voices, text to speech) + the voice stage: one take of the narration, leading
                       silence trimmed, atempo to the preset's words/sec (+ loudnorm to the style's voiceLevel),
                       local-Whisper word timings, voice gate. A take's `characters` are ElevenLabs' bill (its
                       character-cost header; on Viral's account every model bills 0.4 a character of text), its
                       `textCharacters` the text's length.
                       The voice is the project's (`project voice`) or the preset's; ListVoices / PreviewVoice.
                       Library › Voices: Explore ElevenLabs' shared library (ExploreVoices; Narration first), add one
                       (AddLibraryVoice; a full plan's voice slots fail as code "limit"), RemoveVoice (never premade).
                       Voice design (voice-design.ts, DesignVoice): three previews from a description speaking a
                       100–1000-character line (eleven_ttv_v3), saved to voice-previews/ and billed to usage_records;
                       SaveDesignedVoice keeps one on your account only when you click Save. Never cloned from a clip
                       Tests run against a fake HTTP server via ELEVENLABS_API_URL — never add voices to a real account
  sections/            the sections stage (cut-down shorts): an agent picks the creator's best stretches of
                       speech by story beat, hook first (`contact_sheet`, `preview_sections`); the server snaps
                       them to whole sentences (stretch ≤4 s back / 8 s on, else move inward), then whole words, checks length/order/overlaps/excluded ranges, and draws a
                       storyboard with a frame per section. A cut-down run is sections → assemble → render → metadata.
                       With the style's commentQuestion the plan also needs `question` (the end card's; Decision 6: the
                       card alone, 3 s, silent, no narrator).
                       A short from several videos: the agent sees every video (V1, V2… labels, whole transcripts or
                       outlines + `search_transcript`/`read_transcript`), answers with each section's `video` (V number;
                       stored as the 0-based `source`), and each section is snapped and checked in its own video; each
                       storyboard frame comes from its own video
  moments/             the moments stage (ranking shorts, R2; gated "Approve the moments?"): a vision agent
                       (approach-ranking skill) gives every video one entry: before → care → after shots (#1 may take a
                       fourth), the rank, a label (≤24 chars), one emoji and the title (lead + red accent). Its brief has
                       each video's transcript cut into whole sentences, the research shortlist's part and expected
                       moments, the detected framing and the overview sheets; `contact_sheet`, `preview_moments`.
                       moment-rules.ts snaps every cut to whole sentences (the skill's speech.py: a pause over 1.5 s ends
                       one; stretch ≤3 s back / 4 s on, else move inward; an unfixable cut is a problem) and checks ranks
                       1…N, one video per entry, roles in order, ≥0.4 s in, excluded ranges, #1 longest and last, total ≤
                       the research's length (60 s, else 180 s); the play order is shuffled with #1 last (…3, 2, 1).
                       ranking-frames.ts: detect-framing.py decides per moment (upright phone footage inside a
                       widescreen file fills, else a 4:3 window; a video's majority kept in settings), and every shot's
                       first and last frame is drawn (storyboard.py) and compared (frame-stats.py): black ends are
                       problems, ends that look like different scenes go back until the agent sets `framesChecked`, and
                       stay in the plan's `warnings` for you. A ranking run is moments → assemble → render → metadata →
                       thumbnail; CheckRankingEdit checks and snaps an editor change the same way
  shots/               the shots stage: a vision agent anchors b-roll to voiceover words from the contact sheets,
                       asking for 1-per-second detail sheets (`contact_sheet` tool); the server places the
                       script's real lines as inserts/outro, checks the plan, and draws storyboard.png for the gate.
                       A narrated ranking's shots (ShotContext.entries from entriesOnTake) come from each entry's own
                       video and a new shot starts on each entry's "Number" (its rank card); the hook's may be any video.
                       After an insert whose next line is skipped, the narration resumes on the word after it: a shot
                       must start there, none in the skipped words.
                       Several videos: each video's sheets, ads and transcript; `contact_sheet {video}`; each shot
                       names its video; storyboard tiles carry their own video and a V label.
                       Frames are always kept one image per file (contact sheets: frames/frame_NNNNN.jpg;
                       shot plans: frames/shot-NN.jpg…) and stitched from those, so clients can offer any frame
  agent-skills/        the app's skill pack (skills/<name>/SKILL.md) + SkillPack, which loads it. Ported from the
                       creator's own viral-shorts skills (story-arc: format by kind of video, whole sentences, the
                       closing comment question). approach-story-recap (M1) and approach-narrated-ranking (M3) are the
                       newest approaches' skills
  agent-session/       runs every agent stage: isolated session, skills in the prompt, one
                       propose_* tool whose Effect Schema is also its input schema, read-only stage folders,
                       per-stage model, cost + session recording, resume; AgentSession.replay for tests.
                       run-checked.ts: the loop every agent stage uses (ask → server check → hand problems back).
                       A short's agent stages are also offered `tell_creator` when they revise after your note
                       (1–3 plain sentences for the chat, stored on stage_runs.reply; TELL_CREATOR_ON is "revisions"
                       after the evals of decision 10); a revision whose old session can't be resumed, or whose step
                       now runs on another provider (store.latestSession carries the session's provider; AgentSession
                       refuses a cross-provider resume), starts afresh with the brief, its last version as stored
                       (ctx.previous) and the note; a model change on the same provider continues the session on the
                       step's model. Replays can call helper tools (replayAnswer).
                       A task can offer helper tools (`agentTool`) besides its propose_* tool; a helper answers
                       text plus the image files it drew (`toolAnswer(text, images)`): CLIs read the files named in
                       the text, the AI SDK providers attach the images.
                       The providers live in packages/provider-* (below); AgentSession builds the system prompt
                       from the skill pack and routes each task. The route is task.route (evals), else
                       resolveAgentRoute (contracts/settings.ts, shared with the web): the step's own choice, then
                       the default (agents.default); shots, sections, moments and thumbnail need a choice that
                       sees images (`seesImages`: the Claude CLI, or a key model with the catalog's vision badge, a
                       Claude/Gemini/GPT-4o+ family id, or one its vendor's list says takes images, remembered in
                       agents.vision-models when chosen) and otherwise fall back to the Claude CLI (forcedCli).
                       model-images.ts: images for model APIs, over 500 KB scaled by ffmpeg to 1568px JPEGs, cached
                       in ~/.viral/agent-sessions/images/. Providers: claude-cli, codex,
                       opencode, and one AI SDK provider per model key (anthropic, openai, google, openrouter,
                       ai-gateway), each with its vendor's model ids and its key read per run (never put in process.env;
                       *_API_URL moves a vendor for tests). A CLI run gets its CliEnvironment from cli-setup (the 5th
                       AgentRun argument). Every cost is stamped with its provider and billing (billed | subscription:
                       a CLI is billed on a key (cli-setup decides), else the Claude CLI is a plan's value and Codex
                       counts against ChatGPT, tokens only; OpenCode and the key providers always billed) and its cost_basis (reported | estimate |
                       unknown) on stage_runs. key-models.ts (KeyModelLists, ListKeyModels): each key's tool-capable
                       models from the vendor's own list (the key checks' free calls), kept a day
  eval/                the eval harness (`bun run cli eval`): runs ads, story, script and metadata on a fixed fixture
                       (~/.viral/fixtures/candy/eval, made by `eval export`) with no gates, through the production
                       tasks and checks, on any models (claude-cli[:m], codex[:m], opencode:p/m, anthropic:<id>,
                       openai:<id>, google:<id>, openrouter:<v/m>, gateway:<v/m>), in a scratch library; records cost
                       (a run with no known price counts toward --budget at the cautious guess), time, first-try pass and
                       fix rounds, stops priced runs at the budget and plan runs at --plan-runs per CLI, and writes
                       report.json/report.md + a side-by-side eval.html
                       (--include puts earlier evals' runs on the same page). Each run's result and spend is also
                       recorded in your library's eval_runs (eval-records.ts; `eval record <dir>` for an old one),
                       for Settings › Usage (Evals) and Settings › Agents (how each model did).
                       `eval set-story` runs the set-story stage alone on a set fixture (eval-set-fixture.ts:
                       ~/.viral/fixtures/sets/candy-heidi, made by `eval export-set` from a set whose videos are read:
                       each video's short name, transcript, ads and contact sheets, the brief, the set story as
                       reference); eval.html shows each run's 3 proposals side by side, its videos as a colour dot and
                       short name (V labels in the text are put as names too)
  settings/            app preferences as JSON under keys; app-settings.ts is the typed view: agents.default and
                       stage.<name>.provider/.model (Settings › Agents: the Picker for providers in three groups, your
                       plans (Claude CLI Recommended, Codex), pay per run (your API keys), on this Mac (OpenCode), each
                       saying who pays and what it can do, one not set up greyed out with where to set it up, a step's
                       starting with "Use default"; the CLI models carry descriptions and "On your plan"; a key provider's model menu shows the curated
                       MODEL_CATALOG with descriptions, badges Recommended / Sees images / Fast / Cheapest and a cost (an
                       average eval run, else the price per million tokens), then "More from your key" and "Other
                       model…"), transcription.provider; keys.<name>.check holds each key's last Test result (never the key)
  usage/               Settings › Usage: spend by day, provider (billed vs plan), model, short, step, and evals (a cost
                       estimated from tokens shows as ~$, a model with no price as "price unknown", never $0); ElevenLabs
                       in characters (voice takes + "Try a line" previews, recorded in voice_previews) by day, model and
                       short, and the plan's characters used/left and reset date (GetElevenLabsPlan: GET /v1/user/subscription,
                       read-only, cached a minute; needs the key's User › Read permission). A cost estimate shows only when
                       the plan's price is known (its next invoice, in USD). Spend outside a run (usage_records,
                       migration 0009, usage-records.ts: the chat's intent agent as step "chat", voice-design,
                       sound-effect) is read like stage runs, under its short
  render/              the render stage (gated; a rejection goes back to the shots, the sections for a cut-down
                       short or the moments for a ranking, with your note, via the stage's `rejectTo`) + render engine
                       + its Python
                       scripts (render-short.py is the skill's cut-down renderer: word-snapped sections, crop or
                       blurred fill, 3-word captions, hook title card, credit; it plays each section from its own
                       video (`sources` V2…, `exclude_by_source`, a section's `source`), single-video plans unchanged;
                       render-narrated.py is the viral-shorts renderer;
                       music_bed.py is its music-bed math, shared with fit-music.py,
                       ported with JSON-line reporting, plus approach/style features: inserts, full-bleed,
                       headline, chunk/quote captions, labels, credit; and the skill's 10 Nov joins as opt-in keys:
                       an insert's `resume_word`, `insert_pad`, `soft_joins` (fades: clips 0.06/0.15 s, narration
                       pieces 0.04/0.12 s); without them the original code path runs). Both renderers take an opt-in `cta`
                       (end_card.py, the skill's comment-question card: the question in yellow Arial Black 58 px from
                       14.2% down, a red #E62117 SUBSCRIBE pill 536×120 at 81.25%, over a held frame of the clean cut
                       0.2 s before the end; tpad hold + 0.35 s xfade/acrossfade, then loudnorm again; narrated: the
                       voiceover's vo_start–vo_end under it after a 0.35 s lead + 0.6 s air, words in the srt; cut-down:
                       `seconds`, silent). render-end-card.test.ts renders both. render-narrated.py plays each clip from its
                       own video (`source` index into [source, ...sources]) and checks it against that video's ranges;
                       render-narrated-videos.test.ts renders two generated videos and checks colour and pitch.
                       A narrated ranking's opt-in `rank_cards` ({rank, word, word_text}): the skill's "#N" text on each
                       entry's "Number" word (size 0.3, y 0.16 of the band, 1.6 s, red #E8202A, #1 yellow #FFD400),
                       placed by assemble (entriesOnTake), never by the agent; render-rank-cards.test.ts.
                       render-ranking.py is the skill's final ranking style (title with a red accent, the numbered list
                       1 gold / 2 silver / 3 bronze / last red filling in with label + emoji as each entry plays, each
                       clip's own sound to the style's LUFS, window or fill framing, the videos' own subtitles kept, an
                       optional "via <channel>" line); after the render it records `checks` (blackdetect over the
                       window's band only, since the darkened fill turns a night scene "black"; every shot's first/last
                       frame in checks/, measured LUFS) on the RenderedShort. render-ranking-videos.test.ts renders
                       generated videos (one with no audio) on a small canvas.
                       Pieces (R3): before rendering, the stage asks SourcePieces for the stretches the plan plays
                       (footage-ranges.ts) of every scanned video and adds `pieces_by_source` to the plan; every
                       renderer (and render-thumbnail.py, whose `box` is scaled from scan to piece pixels) reads a clip
                       from the piece covering it at (start − piece start) via source_pieces.py, else from the scan,
                       and reports `footage` counts. The RenderedShort's `footage` rows (render gate, CLI, Render step
                       "Footage") say per scanned video how many clips were 1080p and why any weren't; a fallback is
                       also a progress warning. render-pieces.test.ts runs it end to end against the fake yt-dlp.
                       The read-back (M5, viral-shorts step 7 "transcribe the FINAL mp4 and read every line"): after
                       every render (narrated, story-recap, narrated ranking, cut-down, list ranking) the stage
                       transcribes the mp4's audio into <render>/read-back/ (Transcriber, local Whisper preferred so it
                       stays free; the default model, large-v3-turbo, is already on disk for voice takes, ~6 s for a
                       minute; VIRAL_READ_BACK_MODEL picks another) and finds silences (ffmpeg silencedetect −40 dB).
                       read-back.ts (pure) lays out what the short should say, in the renderer's order: the take's
                       words around each insert (skipped lines left out), each real clip's words from its video's
                       transcript in the played seconds, the closing line; it aligns that with what was heard (LCS,
                       numbers spelt out, a long word may be a letter off) and checks: words heard, narration (runs of
                       3+ missing words), real clips (whole sentences in their video, heard), skipped lines absent,
                       every join (nothing lost or garbled), the closing question + subscribe when the style's switch
                       is on (a cut-down's card is silent), a narrated ranking's "Number N"…"Number 1" order, and no
                       silence over 1.2 s (except a cut-down's silent card). Each check is pass or warn with the
                       short's moment; RenderedShort.readBack keeps them (or `problem` when it couldn't run). Warnings
                       never block approval. VIRAL_READ_BACK=off skips it (`bun run test` sets it;
                       render-read-back.test.ts turns it on with a replayed transcriber).
                       Two goldens: the original candy short
                       (must stay identical) and a features render (VIRAL_UPDATE_GOLDEN=1 refreshes it on purpose)
apps/cli/              dev client over RPC, one <domain>-command.ts per command group
apps/web/src/          the UI (vite-plus, React 19, TanStack Router, Effect atoms over the RPC client), feature-based
                       like CarbonMe's dashboard:
  routes/              thin file routes; each renders one module's page
  modules/<feature>/   a feature's page, parts, data atoms, pure values and tests (layout, system, home, waiting,
                       videos, shorts, settings, …). layout/ is the fixed frame: sidebar, title bar, page column.
                       home/: "What would you like to create?" One box (prompt-box.tsx) tells an idea, one or several
                       links, or a dropped/chosen file apart (prompt-values.ts readPrompt; the footer chip says which):
                       an idea → StartResearch, one video → CreateSource + StartSourceRun, several → a video set (the
                       words besides the links are its brief). Link cards show LookupVideoLink's title before anything
                       downloads; the pencil gives a video its short name, sent with CreateSource. Format cards are a hint (made-as.ts outlines the matching set suggestion). Recents
                       (recents.tsx, recents-values.ts): shorts, sets and single videos with their status, tabs,
                       + Status filter, search, list/grid (kept per viewer). No stat cards. Waiting for you is
                       /?status=waiting (home-search.ts); /waiting and /videos/new redirect to Home.
                       videos/: a video's page (GetSourceOverview; the source run followed live
                       by folding SubscribeRun in run-progress.ts); frames come from contact-sheet stills, or from
                       sheet tiles on older sheets. "Make this short" asks for the optional brief first and offers
                       "As suggested" / "Story recap" (VIDEO_APPROACHES; make-short-dialog.tsx). research/: while a research set has no videos
                       (or a replacement waits) its page is the shortlist (shortlist-view.tsx: grey rows while it
                       searches; then remove, ⋯ ask for another (backups first), earlier/later, add a link
                       (LookupShortlistVideo), ask for a new list, undo; a changed list goes through
                       CheckShortlistEdit before Download); replace-dialog.tsx is "Replace this video" on the set page
                       sets/: a video set's page (/sets/<id>): Videos (each video's reading, live from its own run)
                       and Proposals ("Make this short" starts from the set's brief). Sets are listed in the
                       sidebar's Video sets. The UI never says "V1"/"V2" (it reads as a version): a video is its
                       colour dot and a short name: the one you gave it (Source.shortName), else one from its title ("Heidi
                       Klum", else "Video 2"; set-values.ts videoColor/videoNames/sourceNames, video-badge.tsx; the
                       editor's names come from short-videos.tsx), with
                       the full title on hover; single-video shorts show none. The title bar's videos chip
                       (videos-menu.tsx) lists the short's videos, removes one, and opens "Add a video to this short"
                       (add-video-dialog.tsx: the library, or a link/file with its rights; just add, or add and
                       re-run from Script/Sections)
                       shorts/: a short's editor, filling the window (no app sidebar on /shorts/*), one fixed frame
                       for every step (editor-frame.tsx): the top bar (editor-top-bar.tsx: back, the title renamed
                       in place with RenameProject, the videos' dots opening VideosMenu, the slim StepBar that folds
                       to numbers when the names don't fit, 9:16, ⋯ Brief… / Videos… / Show in Finder (the short's
                       `folder`) / theme / Simple–Detailed, and the primary: the waiting step's Approve, else Publish
                       or Publish again, disabled with a reason until a render exists); the rail (editor-rail.tsx,
                       railFor: Library, Script/Ranks/Sections, Captions or Titles, Voice, Music, Style; a dot where
                       the waiting step lives) opening one panel (panel.tsx shell) without changing the step, each
                       step opening its own (panelForStep: Shots and Render → Library, Publish → Post, Thumbnail →
                       its panel); the player (editor-player.tsx: "Waiting for you · what to check" with Ask in chat
                       and Approve, the step's stage, "1080×1920 · style"); the chat column (chat/: chat-column.tsx
                       follows SubscribeChat (chat-api.ts, folded by chat-values.ts): the run's line, Stop, the clock
                       (jump to the latest) and ⋯ (copy); each item (chat-items.tsx: your bubble and what the server
                       did with it, the agent's words with the change card — old struck through, new highlighted — and
                       "The server checked it", the gate card with Approve / Ask for changes / Edit it myself, which the
                       waiting bar answers too, "You approved the …", "Stop and redo from …" on your latest message, a
                       skeleton reply while an agent works); typed chips per step (chipsFor: words for the step's
                       agent, an action as it is, or a panel opened); the composer (disabled on agent steps the run
                       hasn't reached; Detailed shows which agent, provider and model answer and whether it's on your
                       plan)); below about 1100px it's an overlay the top bar opens. The multi-track timeline (264px, under rail, panel and player;
                       display only: no undo, cut or snap yet) is editor-timeline.tsx → track-values.ts tracksFor (pure,
                       tested: a lane per video with its dot and short name, never V1/V2, holding the shots and real
                       lines / sections / ranking moments it gives, each with its still tiled (a narrated ranking adds
                       an Entries lane on top, "#N · video" from each "Number" to the next, and the #N cards marked on
                       the voice lane); then Voice (narration
                       with vo.wav's waveform, use-audio-peaks.ts decodes a file once per page), a ranking's Entries
                       and Sound / a cut-down's Sound per section, Music (the bed's or the arrangement's parts, the
                       drop marked; "No music" lanes otherwise) and Captions pinned under the video lanes) drawn by
                       multi-track.tsx (time, play/pause, a zoom slider + Fit, the playhead; a lane's ⋯ hides it per
                       viewer or renames a video with RenameVideo). The play button and seeking drive the open step's
                       player through transport.ts (ShortPlayer on Render/Publish, VoiceStage, the music BedPlayer);
                       elsewhere the playhead marks the selected shot, section or entry. A clicked clip opens where it's
                       edited (a shot → Library › Shot n, a real or narration line → the Script panel's line, a music
                       part → Arrange, a section or entry → its step, a caption → Captions). Captions
                       (use-caption-cues.ts, caption-cues.ts): the render's .srt while the render is current (a narrated
                       render's word-per-line .srt grouped as the style shows it), else worked out from the words the
                       way each renderer groups them (narrated: the voiceover's words with each real line's quote
                       spread over its clip; cut-down and ranking: the videos' words); the Captions panel lists the
                       same cues. State lives in
                       use-editor-state.ts (gateFor(step), each step's selection and draft, the open panel); each
                       step's player and panel in <step>/<step>-step.tsx; library-panel.tsx (This short: videos,
                       frames, real lines, song, voice; Your library with your sounds; Explore: ElevenLabs' shared
                       voices (free samples), Viral's bundled songs and sounds and your kept references
                       (library-panel-values.ts exploreItems/soundItems); type chips, search, + Video / + Used /
                       + Rights; a frame opens Library › Shot n with the frame picker and framing; Create + opens a
                       generator), generator/ (one shape, Model → Prompt → Inputs → Properties → Generate, with the
                       cost before Generate: voice-generator.tsx (Voice Design; also Library › Voices' Create Voice in
                       a Sheet and the Voice panel's Create), sound-generator.tsx (At a word / Match the song hints,
                       kind, length, loop, takes, follow the prompt), thumbnail-generator.tsx (the Thumbnail panel's
                       Generate view: the thumbnail step's model in the shared picker, a prompt and another hero become
                       a note sent through SendChat; properties alone at the gate redraw with CheckThumbnailEdit +
                       Edit; generator-values.ts holds the mapping), captions-panel.tsx (read-only style settings, highlighted words, the captions as
                       they'll be shown; a ranking's titles), style-panel.tsx (SetProjectPreset, then a re-render
                       from assemble once the steps before the render are approved). The Script panel holds the
                       lines (edit a line at the gate; CheckScriptEdit first so a bad one never fails the run) and
                       the rules and headline; its player previews the selected line 9:16 (script-preview.tsx). The
                       closing question (Cta) is the last row, editable at the gate, previewed as its end card.
                       editor-values.ts lays the short out on its timeline the way the renderer plays it (layoutTimeline,
                       each narration line with its voiceover seconds; the closing line cut out of the narration and,
                       with the style's commentQuestion, `closing.card`: the end card after the outro on V1's lane and
                       its line on the voice's; a cut-down's card after its last section, 3 s). The Style editor's
                       Ending group has "End with a comment question".
                       shots/: the Shots step (preview in the style's framing or the storyboard in the player; the
                       selected shot in Library › Shot n: a frame picker over ListFramesAround stills, framing/crop/speed); its
                       changes collect into one edit, checked with CheckShotsEdit before it answers the gate.
                       Edits to an approved short's shots aren't supported yet (only at the gate).
                       music/: the Music step (narrated shorts only; it opens once assemble has run): the fitted bed
                       (GetMusicBed) played with the voiceover, which pauses where real lines play, the bed's
                       parts and the drop word marked; the inspector's song (tempo, rights, the part of the song
                       that plays on its waveform), Change song over the library plus No music, and the drop word
                       picked from the narration. Applying calls RefitMusic (stopping a run that's going) and
                       follows the re-run from assemble; no song is a calm "Voice only", never a warning.
                       Detailed mode adds an Arrange tab (music-arrange.tsx, use-arrange-draft.ts): the bed's
                       arrangement blocks as parts ("Bars 9–12 ×3", "Drop") on the Music lane (click to select),
                       the selected part's
                       bars dragged on the song's waveform (snapping to bars), plays, start (after / drop word /
                       a word picked on the stage's narration), ⋯ Split, Duplicate, Move, Delete; Add a part;
                       Reset to automatic. Edits are a draft (undo, Discard) checked client-side
                       (music-values.ts mirrors the bed's layout) and on the server: Preview plays a
                       PreviewMusicArrangement bed on the stage, Apply calls ArrangeMusic and follows the re-run

                       render/: the Render step (the mp4 in a 9:16 player the timeline's playhead follows; the
                       check sheet toggled under it, "Check sheet · N to look at" when the read-back warns; its "Read
                       back" block lists what was heard, warnings first, each time a button that plays the short from
                       there (read-back-values.ts); the chat's render card lists the same checks with their times;
                       sending back to Shots/Sections/Ranking or Style from the chat:
                       a chip, or your words through the intent agent). publish/: the post
                       text (choose or write a title, edit the description and hashtags from ⋯, copy it all; saved on
                       the short with SetPostText), "Publish again" with what it will update, the files, and a
                       rights reminder. thumbnail/: an AI
                       round's three options side by side in phone frames (the one in use outlined, each with its face
                       check or why it wasn't made, Use this at the gate = Edit {choose: n}), the Options view (real
                       frames, checks, cost), and the Generate panel (a note for another round, the frames as inputs,
                       the round's cost before Generate); a basic thumbnail in a phone frame, its moments (each with
                       its video's dot and short name), and word edits checked with CheckThumbnailEdit.
                       sections/: the Sections step of a cut-down short (preview or storyboard of the sections in
                       order, each playable from its own video; inspector: words, beat, start/end stepped a whole
                       sentence at a time (nudgeSentence; words where the transcript has no punctuation), framing, order, remove, add a line found in any video; edits checked with
                       CheckSectionsEdit). Several videos: each section carries its video's dot + short name and sits
                       in its video's lane on the timeline
                       ranking/: the Ranking step of a ranking short (Ranking → Render → Publish → Thumbnail): the stage
                       plays the chosen entry's shots in their framing (fill, or a 4:3 window over a blur) under a CSS
                       copy of the title and the list, filled for every entry played so far; the inspector's ranks
                       (#1 first: dot + short name, label, emoji, before/care/after stills, up/down, ⋯ Remove / Open
                       the video), a shot's moment swapped with the frame picker (its length kept) or nudged
                       (Detailed), "Shuffle again" with #1 last (ranking-values.ts ports the server's shuffle) and the
                       order and title in Detailed; every change goes through CheckRankingEdit (snapped to whole
                       sentences) and answers the gate as one Edit. The Render step shows a ranking's checks
                       (loudness, black frames, each shot's first/last frame) and sends back to Ranking.
                       make-short-dialog.tsx can offer "As suggested" / "Ranking (narrated)" / "Ranking (list)" / "Story recap" (SET_APPROACHES) and
                       passes the choice to onMake; the Styles editor has the "Ranking credit" switch (rankingVia) and,
                       under Voice, "Level with the clips" (voiceLevel) and "Soft joins" (softJoins).
                       Script step of a narrated ranking (scriptLimits.ranking): lines grouped under the Hook and each
                       entry's "#N" (card colour, its video, about how long, + #1's reveal; countdown-values.ts), the
                       ending real take labelled "Reveal", and a Countdown block in Rules.
                       Script step: a skipped line shows "skipped, the real line says it" and toggles with "Let the real
                       line say it" / "Narrator says it" at the gate; the Rules view has a payoff-take meter for
                       story-recap. editor-values.ts lays a skipped line out as a jump (a pause's `skip`) and a soft-joins
                       style's breath before each clip, as the renderer plays them
                       library/: Styles (cards with a CSS 9:16 preview of each style; the editor at ?edit=<id>, whose
                       Voice group holds the style's voice and pace), Music (songs with a decoded waveform and drop,
                       kind and rights, add songs or a folder; "Used by" opens each short's editor) and Voices (free
                       samples, a paid "Try a line", the default style's voice tagged Default, "Set as default"
                       (SetDefaultVoice) and "Use for style" for the other styles). There is no Settings › Voice: the
                       default voice lives in Library › Voices, pace in the style editor. Loading is a skeleton of the page (library-loading.tsx), never a spinner
  api/                 the RPC client (AtomRpc over one WebSocket) and the atom registry
  lib/  config/        small shared helpers (media URLs, formatting); where the server is
apps/desktop/          the Electron shell: starts the server (node in dev; Electron's own Node packaged), opens the
                       UI (the dev server, or viral://app/ from Resources/web with a strict CSP), window buttons
                       over the sidebar, preload bridge (server URL, user name, inset, Show in Finder, the open
                       panel for a video or audio file, several files, or a folder), electron-updater.
                       vp pack bundles main/preload and the server (dist-server); electron-builder makes Viral.app
packages/contracts/    wire schemas + RpcGroups, one file per domain
packages/provider-core/ AgentTask/AgentRun/AgentError and toolEndpoint: the per-run MCP server (127.0.0.1, random
                       bearer token) serving a task's output and helper tools to Codex and OpenCode
packages/provider-claude-cli/ the Claude CLI via the Agent SDK (in-process tools, stop after the output tool); a run's
                       CliEnvironment goes to `query({ env })` over the server's own env. Tests: a fake `claude` that
                       reports its environment
packages/provider-ai-sdk/ the AI SDK providers on your own keys: Anthropic, OpenAI, Google, OpenRouter and the Vercel
                       AI Gateway, one shared generateText loop (tools, brief images, history in ~/.viral/agent-sessions/
                       under a per-vendor session prefix for resume) with per-vendor bits in ai-sdk-vendors.ts (factory,
                       Anthropic cache markers, cost, where tool images go). ai-sdk-images.ts: a helper's images come
                       back as image content in its tool result (OpenRouter: a user message after it), view_image
                       shows any image in the step's folders, ≤4 images a result, ≤24 a run, only the newest 6 kept
                       in each step's messages (prepareStep); history keeps file paths, never bytes. ai and @ai-sdk/* pinned exactly to one provider-utils; cost is
                       reported by the gateway (BYOK market cost) and OpenRouter (usage.cost), else tokens × contracts'
                       PRICES (model-catalog.ts) marked "estimate"; an unknown model's cost is null ("price unknown",
                       never $0). Tests: fake vendor servers + mock models; ai-sdk-provider.live.ts per key, skipped
                       without one
packages/provider-codex/ our own `codex app-server` JSON-RPC client: one app-server per run in a scratch folder,
                       read-only sandbox, approvals never, shell/apps/plugins/skills off, the user's MCP servers
                       switched off by name; model + effort from the account's catalog; thread/resume; turn
                       interrupted once the output tool accepts. startCodex: a run's variables on the spawn, and on an
                       API key its own CODEX_HOME + login over stdin (API_KEY_ARGS). codexStatus for Settings (asked the
                       way a run starts). Tests use a fake app-server
packages/provider-opencode/ OpenCode 2 only: `opencode serve` per run (free port, password) configured by
                       OPENCODE_CONFIG_CONTENT (Viral agent; permission rules deny everything but viral_* tools); our
                       own client for its /api (no v2 SDK: sessions, prompt, SSE events, interrupt once the step that
                       sent the output ends), USD cost from the session's totals; refuses OpenCode < 2.2.6 with how to
                       update. Status asks `--standalone` (not the background service): any stored credential (incl.
                       the OpenCode Console, whose opencode/* models count) is signed in. Tests use a fake
packages/provider-testing/ replayRun, the replay provider behind AgentSession.replay, and the live checks' task (*.live.ts)
packages/ui/           @viral/ui: Tailwind v4 tokens (theme.css: CarbonMe's values, lemon primary, dark and light,
                       28/32px controls) and primitives on Base UI + cva (incl. Dialog, Textarea, Sheet, EmptyState: an
                       icon, a title, one sentence and at most one button, used for every empty place; Picker: the
                       searchable grouped popover with descriptions and badges that Settings › Agents' provider and
                       model choices and the generators' Model rows use)
repos/                 gitignored reference source checkouts — read-only
scripts/               repo tooling (sync-repos.ts)
```

- Agent stages: a small TypeScript prompt in the stage's domain (`script/script-prompt.ts`) holds the stage's
  job and tool contract; the domain knowledge lives in the app's skill pack, `apps/server/src/agent-skills/`
  (a Claude Code plugin layout: `skills/<name>/SKILL.md`). `SkillPack` loads it at startup and appends a
  stage's skills to its system prompt. Skills are injected, not left to the Skill tool: the SDK's skill
  "preload" doesn't put content in a main-thread session, and a model that skips the lookup ignores the rules.
- Python scripts are standalone uv scripts (PEP 723 inline deps) next to the code that runs them. They
  write one JSON object per stdout line and report failure as `{"type":"error","code","message"}`;
  run them through `ScriptRunner`.
- Tests sit next to the file they cover (`script-prompt.test.ts`).
- A package exists only when it stands alone and is named for its purpose (`contracts`). Never add a
  generic `shared`/`utils`/`common` package or folder.

The database schema is designed up front in `docs/plans/database-schema.md` (local, gitignored) and
the migration matches it statement for statement. Change the design first, then the migration.

## Reference repos

`repos/` is gitignored and holds read-only source checkouts for agents to read. Run
`bun run repos:sync` to clone them (refs are pinned in `scripts/sync-repos.ts` and must match the
dependency versions in package.json). `repos/effect` is Effect v4 — start with
`repos/effect/LLMS.md` and `repos/effect/ai-docs/`.

- Use the reference repos as read-only material when working with related libraries. Prefer examples
  and patterns from their source over generated guesses or web search results. Effect v4 APIs differ
  a lot from v3 — check `repos/effect/packages/effect/src` first.
- Do not edit files under `repos/` and do not import from `repos/`.

ElevenLabs' agent skills (`sound-effects`, `music`, `text-to-speech`, `speech-to-text`, `voice-isolator`)
are installed for coding agents in `.agents/skills/` (symlinked into `.claude/skills/`, pinned in
`skills-lock.json`). Read the relevant one before calling an ElevenLabs API. They are coding-time help only:
the app's own agents load the app's skill pack, never these. Restore with `npx skills experimental_install`.

T3 Code (whose architecture we follow) is not included; if a local clone exists at
`~/Apps/Opensource/t3code`, read it there for reference.

## Commands

```bash
bun install           # also patches TypeScript with @effect/tsgo
cp .env.example .env  # API keys (gitignored); or store them in the Keychain:
                      #   security add-generic-password -s viral -a xai -w
bun run repos:sync    # clone reference source into repos/ (gitignored)
bun run typecheck     # effect-tsgo tsc per project: node (server, cli, contracts), ui, web, desktop
bun run dev           # the web dev server (:5733) + the desktop app, which starts the server; Ctrl-C stops all
                      #   (VIRAL_HOME=~/.viral/work/live-check bun run dev to open another library)
bun run dev:server    # node --watch apps/server/src/main.ts  (port 3410), for the CLI or the browser
bun run dev:web       # the UI alone at http://127.0.0.1:5733 (against a running server)
bun run cli tools install # download the missing tools (also happens on the app's first run)
bun run package:desktop # build the UI and Viral.app (apps/desktop/release/mac-arm64, unsigned)
bun run cli           # dev client; prints every command
bun run test          # node --test over apps and packages (8 files at a time; renders with x264 ultrafast)
bun run cli eval all --models claude-cli,codex,gateway:openai/gpt-6-luna,anthropic:claude-haiku-5-5 --runs 2 --budget 3 --plan-runs 8
                      # agent-stage eval vs the CLI baseline → ~/.viral/evals/<date>-<stages>/eval.html
                      # (spend recorded in your library; --include <earlier eval dirs> combines the pages)
bun run cli eval set-story --models claude-cli,codex,gateway:anthropic/claude-haiku-5.5 --runs 1 --budget 1.5 --plan-runs 4
                      # set-story across 2 videos (fixture: ~/.viral/fixtures/sets/candy-heidi; make another with
                      #   eval export-set --from <library> --set <id> --name <name> [--names "Candy,Heidi Klum"])
bun run test:golden   # candy render vs the original short + transcription per provider (slow; needs fixtures:sync)
bun run test:live     # each agent provider on its real CLI (Claude, Codex, OpenCode; a cent or so); skips any not set up
bun run fixtures:sync # copy the candy project (plans, media, golden outputs) into ~/.viral/fixtures (not in git)
```

A short from start to finish with the dev client (the server running):

```bash
bun run cli source add --file ~/videos/candy.mp4 --rights owned
bun run cli source run <source-id>                 # transcribe → contact sheets → ads → story; prints 3 proposals
bun run cli project from-proposal <source-id> <n>
# or several videos: a set, its story across them, and a short from one of its proposals
bun run cli set create <source-id>,<source-id> --brief "<why they belong together>"
bun run cli set run <set-id> [--again]             # reads each video, then prints 3 proposals across them
bun run cli set make <set-id> <n>
# or from an idea: Viral searches YouTube, you approve the shortlist, then it downloads and reads them as a set
bun run cli research start "<idea>" [--videos 5] [--length 60|180|any]   # stops at the shortlist
bun run cli research show <set-id>                 # the shortlist again; approve / reject "note" / edit <file>
bun run cli project style <project-id> <preset-id|default>   # see `preset list`
bun run cli music add <file> --rights owned && bun run cli music beat <track-id> <bpm> <drop-s>
bun run cli project music <project-id> <track-id|none>       # none = voice only
bun run cli project music-arrange <project-id> <file.json|auto> # the bed's arrangement (blocks of bars, loops, pins)
bun run cli project voice <project-id> <voice-id|preset>     # see `voices`
bun run cli project run <project-id> [--from <stage>]        # stops at each gate
bun run cli approve <request-id> | reject <request-id> "note" | edit <request-id> <file.json>
bun run cli chat send <project-id> <step> "text"      # the short's chat: a note at its gate, a redo once approved,
                                                    #   an action on voice/music/render/style; chat show <project-id>
```

Finished shorts (mp4, srt, post notes) land in `~/.viral/renders/`.

Runtime is Node 24, which runs `.ts` directly via type stripping — use only erasable TS syntax (no
enums, namespaces or parameter properties). bun is the package manager.

## Conventions

- File names are kebab-case (`script-agent.ts`). Importable Python modules are snake_case.
- Effect v4 on the server: services as `Context.Service` with a static `layer`, keys
  as the `deterministicKeys` diagnostic expects, processes via `effect/process`, RPC via `effect/rpc`. Wrap SDK
  promises once at the seam; no raw Promises in server logic.
- Anything crossing a boundary (RPC, child-process JSON, agent tool input) is an Effect `Schema`.
  Schemas for files the Python scripts read (`narrated-plan.ts`, `thumb-config.ts`, `transcript.ts`)
  keep the scripts' snake_case keys, and their tests decode the candy fixtures with
  `onExcessProperty: "error"` so a key the schema doesn't model fails loudly.
- Commits follow Conventional Commits v1.0.0. No AI attribution lines in commits or PRs.
